'use strict';

/**
 * The customer's own record: contact details, documents and photo, security
 * settings, the devices they are signed in on, and their activity history.
 *
 * What a customer may change about themselves is deliberately narrow. A name,
 * a date of birth or a Social Security number is changed by the bank after a
 * document has been seen, not by a form - so those fields are absent from
 * SELF_EDITABLE and only the admin console can touch them.
 */

const { db } = require('../../bank/db');
const users = require('../../bank/users');
const security = require('../../bank/security');
const auth = require('../../bank/auth');
const audit = require('../../bank/audit');
const alerts = require('../../bank/alerts');
const contact = require('../../bank/contact');
const ids = require('../../bank/ids');
const { asyncHandler, fail, trimmed } = require('../../bank/http');
const { DOCUMENT_KINDS, SECURITY_QUESTIONS, US_STATES, BANK } = require('../../bank/constants');

const nowIso = () => new Date().toISOString();

/** What a customer may change without talking to anyone. */
const SELF_EDITABLE = {
  preferredName: 'preferred_name',
  phone: 'phone',
  mobile: 'mobile',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  state: 'state',
  postalCode: 'postal_code',
  employmentStatus: 'employment_status',
  employer: 'employer',
  occupation: 'occupation',
  language: 'language',
  timezone: 'timezone',
};

const me = asyncHandler(async (req, res) => {
  const [accounts, cards, sessions] = await Promise.all([
    db.accounts.find({ user_id: req.bankUser.id }),
    db.cards.find({ user_id: req.bankUser.id }),
    db.sessions.find({ user_id: req.bankUser.id, revoked_at: null }, { order: 'last_seen_at.desc', limit: 10 }),
  ]);
  res.json({
    user: users.publicUser(req.bankUser, 'self'),
    counts: { accounts: accounts.length, cards: cards.length, sessions: sessions.length },
    options: { states: US_STATES, securityQuestions: SECURITY_QUESTIONS, documentKinds: DOCUMENT_KINDS },
    bank: { name: BANK.name, email: BANK.email, ...contact.current() },
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  const patch = users.patchFromBody(req.body, SELF_EDITABLE);
  if (!Object.keys(patch).length) throw fail(400, 'Nothing to change.');

  const before = req.bankUser;
  await db.users.update(before.id, patch);
  const after = await db.users.findById(before.id);

  const changed = Object.keys(patch).filter((k) => k !== 'updated_at' && before[k] !== after[k]);
  await audit.log({
    action: 'profile.updated', category: 'account', userId: before.id, req,
    actor: { id: before.id, email: before.email, role: 'customer' },
    detail: `Updated ${changed.map((c) => c.replace(/_/g, ' ')).join(', ') || 'profile'}`,
    meta: { fields: changed },
  });
  await alerts.notifyUser(after, 'profile_changed', {
    subject: 'Your Rockfield profile was updated',
    heading: 'Your details changed',
    intro: 'These contact details on your account were just updated.',
    rows: changed.map((field) => ({ label: field.replace(/_/g, ' '), value: String(after[field] || '-') })),
    footNote: `If you did not make this change, please ${contact.callFraud()}.`,
  });
  res.json({ user: users.publicUser(after, 'self') });
});

/* ----------------------------------------------------------- documents --- */

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

/** Pull a data URL apart, refusing anything that is not an image or a PDF. */
function parseDataUrl(dataUrl) {
  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || '').trim());
  if (!match) throw fail(400, 'Upload a JPEG, PNG, WebP or PDF file.');
  const [, mime, base64] = match;
  if (!/^(image\/(jpeg|png|webp|heic|gif)|application\/pdf)$/i.test(mime)) {
    throw fail(400, 'That file type is not accepted. Use a JPEG, PNG, WebP or PDF.');
  }
  const buffer = Buffer.from(base64.replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw fail(400, 'That file is empty.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw fail(413, 'That file is larger than 6MB. Try a smaller photo.');
  return { mime, buffer, base64: base64.replace(/\s/g, '') };
}

/**
 * Store an uploaded document.
 *
 * The bytes go into the row as a data URL rather than onto disk, because the
 * production target is serverless and has no writable filesystem worth the
 * name. Serving happens through the route below, which re-checks ownership.
 */
async function storeDocument({ user, kind, filename, dataUrl, uploadedBy = 'customer', uploadedById = null, note = '' }) {
  const { mime, base64, buffer } = parseDataUrl(dataUrl);
  const doc = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: user.id,
    kind,
    filename: trimmed(filename, 160) || `${kind}.${mime.split('/')[1] || 'bin'}`,
    mime,
    size: buffer.length,
    data: `data:${mime};base64,${base64}`,
    status: 'received',
    uploaded_by: uploadedBy,
    uploaded_by_id: uploadedById,
    note,
    reviewed_at: null,
  };
  await db.documents.insert(doc);
  return doc;
}

const publicDocument = (doc) => ({
  id: doc.id,
  kind: doc.kind,
  kindLabel: (DOCUMENT_KINDS.find((k) => k.id === doc.kind) || {}).label || doc.kind,
  filename: doc.filename,
  mime: doc.mime,
  size: doc.size,
  status: doc.status,
  note: doc.note,
  uploadedBy: doc.uploaded_by,
  createdAt: doc.created_at,
  url: `/api/bank/documents/${doc.id}/file`,
});

const listDocuments = asyncHandler(async (req, res) => {
  const rows = await db.documents.find({ user_id: req.bankUser.id }, { order: 'created_at.desc' });
  res.json({ documents: rows.map(publicDocument), kinds: DOCUMENT_KINDS });
});

const uploadDocument = asyncHandler(async (req, res) => {
  const kind = trimmed(req.body.kind, 40) || 'other';
  if (!DOCUMENT_KINDS.some((k) => k.id === kind)) throw fail(400, 'Choose what this document is.');

  const doc = await storeDocument({
    user: req.bankUser,
    kind,
    filename: req.body.filename,
    dataUrl: req.body.file,
    note: trimmed(req.body.note, 200),
  });

  // A profile photo is also the avatar, so the header changes immediately.
  if (kind === 'avatar') {
    await db.users.update(req.bankUser.id, {
      photo_url: `/api/bank/documents/${doc.id}/file`,
      photo_document_id: doc.id,
      updated_at: nowIso(),
    });
  }

  await audit.log({
    action: 'document.uploaded', category: 'account', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Uploaded ${publicDocument(doc).kindLabel} (${Math.round(doc.size / 1024)}KB)`,
    meta: { documentId: doc.id, kind },
  });

  res.status(201).json({ document: publicDocument(doc), photoUrl: kind === 'avatar' ? `/api/bank/documents/${doc.id}/file` : undefined });
});

/** Serve the bytes. Owner or staff only; everyone else gets a 404. */
const documentFile = asyncHandler(async (req, res) => {
  const doc = await db.documents.findById(req.params.id);
  const viewer = req.bankUser;
  if (!doc || !viewer || (doc.user_id !== viewer.id && viewer.role !== 'admin')) throw fail(404, 'Document not found.');

  const match = /^data:([^;]+);base64,(.*)$/s.exec(doc.data || '');
  if (!match) throw fail(404, 'Document not found.');
  const buffer = Buffer.from(match[2], 'base64');
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', `inline; filename="${doc.filename.replace(/"/g, '')}"`);
  res.send(buffer);
});

const deleteDocument = asyncHandler(async (req, res) => {
  const doc = await db.documents.findById(req.params.id);
  if (!doc || doc.user_id !== req.bankUser.id) throw fail(404, 'Document not found.');
  if (['id_front', 'id_back', 'ssn_card'].includes(doc.kind)) {
    throw fail(409, 'Identity documents are kept on file. Call us if one needs replacing.');
  }
  await db.documents.remove(doc.id);
  if (req.bankUser.photo_document_id === doc.id) {
    await db.users.update(req.bankUser.id, { photo_url: '', photo_document_id: null });
  }
  await audit.log({
    action: 'document.deleted', category: 'account', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Removed ${doc.filename}`,
  });
  res.json({ status: 'ok' });
});

/* ------------------------------------------------------------ security --- */

const securitySettings = asyncHandler(async (req, res) => {
  const sessions = await db.sessions.find({ user_id: req.bankUser.id, revoked_at: null }, { order: 'last_seen_at.desc' });
  const recent = await audit.forUser(req.bankUser.id, 25);
  res.json({
    twoFactorEnabled: Boolean(req.bankUser.two_factor_enabled),
    twoFactorMethod: req.bankUser.two_factor_method,
    hasTransferPin: Boolean(req.bankUser.transfer_pin_hash),
    securityQuestion: req.bankUser.security_question,
    securityQuestions: SECURITY_QUESTIONS,
    passwordChangedAt: req.bankUser.password_changed_at,
    alertThreshold: req.bankUser.alert_threshold,
    lowBalanceThreshold: req.bankUser.low_balance_threshold,
    sessions: sessions.map((s) => ({
      id: s.id,
      device: s.device,
      deviceKind: s.device_kind,
      ip: s.ip,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      current: Boolean(req.bankSession && s.id === req.bankSession.id),
    })),
    activity: recent.map((a) => ({
      id: a.id, action: a.action, detail: a.detail, category: a.category,
      severity: a.severity, ip: a.ip, device: a.device, createdAt: a.created_at,
    })),
  });
});

const updateSecurity = asyncHandler(async (req, res) => {
  const user = req.bankUser;
  const patch = {};
  const notes = [];

  if (req.body.twoFactorEnabled != null) {
    patch.two_factor_enabled = Boolean(req.body.twoFactorEnabled);
    notes.push(`Two-step verification ${patch.two_factor_enabled ? 'switched on' : 'switched off'}`);
  }
  if (req.body.alertThreshold != null) {
    patch.alert_threshold = Math.max(0, Math.round(Number(req.body.alertThreshold) * 100));
    notes.push('Large-transaction alert threshold changed');
  }
  if (req.body.lowBalanceThreshold != null) {
    patch.low_balance_threshold = Math.max(0, Math.round(Number(req.body.lowBalanceThreshold) * 100));
    notes.push('Low-balance alert threshold changed');
  }
  if (req.body.securityQuestion && req.body.securityAnswer) {
    patch.security_question = trimmed(req.body.securityQuestion, 160);
    patch.security_answer_hash = await security.hashSecret(String(req.body.securityAnswer).trim().toLowerCase());
    notes.push('Security question changed');
  }
  if (req.body.transferPin) {
    const pin = String(req.body.transferPin).trim();
    if (!/^\d{4,6}$/.test(pin)) throw fail(400, 'Your transfer PIN must be 4 to 6 digits.');
    // Changing an existing PIN requires the current one, or the password.
    if (user.transfer_pin_hash) {
      const currentOk = req.body.currentPin
        ? await security.verifySecret(String(req.body.currentPin), user.transfer_pin_hash)
        : await security.verifySecret(String(req.body.password || ''), user.password_hash);
      if (!currentOk) throw fail(403, 'Enter your current PIN or your password to change it.');
    }
    patch.transfer_pin_hash = await security.hashSecret(pin);
    notes.push('Transfer PIN set');
  }

  if (!Object.keys(patch).length) throw fail(400, 'Nothing to change.');
  patch.updated_at = nowIso();
  await db.users.update(user.id, patch);

  await audit.log({
    action: 'security.updated', category: 'security', userId: user.id, req, severity: 'notice',
    actor: { id: user.id, email: user.email, role: 'customer' },
    detail: notes.join('; '),
  });
  await alerts.notifyUser(await db.users.findById(user.id), 'password_changed', {
    subject: 'Your Rockfield security settings changed',
    heading: 'Security settings updated',
    intro: notes.join('. ') + '.',
    footNote: `If this was not you, please ${contact.callFraud()}.`,
  });
  res.json({ status: 'ok', user: users.publicUser(await db.users.findById(user.id), 'self') });
});

const revokeSession = asyncHandler(async (req, res) => {
  const row = await db.sessions.findById(req.params.id);
  if (!row || row.user_id !== req.bankUser.id) throw fail(404, 'Session not found.');
  await db.sessions.update(row.id, { revoked_at: nowIso() });
  await audit.log({
    action: 'security.session_revoked', category: 'security', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Signed out ${row.device}`,
  });
  res.json({ status: 'ok' });
});

const revokeAllSessions = asyncHandler(async (req, res) => {
  const count = await auth.revokeOtherSessions(req.bankUser.id, req.bankSession && req.bankSession.id);
  await audit.log({
    action: 'security.sessions_revoked', category: 'security', userId: req.bankUser.id, req, severity: 'notice',
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Signed out ${count} other device(s)`,
  });
  res.json({ status: 'ok', signedOut: count });
});

/* ------------------------------------------------------------ activity --- */

const activity = asyncHandler(async (req, res) => {
  const rows = await audit.forUser(req.bankUser.id, Math.min(Number(req.query.limit) || 100, 300));
  res.json({
    activity: rows.map((a) => ({
      id: a.id, action: a.action, category: a.category, detail: a.detail,
      severity: a.severity, ip: a.ip, device: a.device, channel: a.channel,
      actorRole: a.actor_role, createdAt: a.created_at,
    })),
  });
});

/* ---------------------------------------------------- alert preferences --- */

const alertPreferences = asyncHandler(async (req, res) => {
  res.json({
    preferences: alerts.preferencesFor(req.bankUser),
    types: alerts.ALERT_TYPES,
    alertThreshold: req.bankUser.alert_threshold,
    lowBalanceThreshold: req.bankUser.low_balance_threshold,
    paperless: Boolean(req.bankUser.paperless),
  });
});

const updateAlertPreferences = asyncHandler(async (req, res) => {
  const incoming = req.body.preferences || {};
  const next = { ...alerts.preferencesFor(req.bankUser) };
  alerts.ALERT_TYPES.forEach((type) => {
    if (type.locked) { next[type.id] = true; return; }
    if (incoming[type.id] !== undefined) next[type.id] = Boolean(incoming[type.id]);
  });
  const patch = { alert_prefs: next, updated_at: nowIso() };
  if (req.body.paperless != null) patch.paperless = Boolean(req.body.paperless);
  await db.users.update(req.bankUser.id, patch);
  await audit.log({
    action: 'alerts.preferences_updated', category: 'account', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: 'Changed alert preferences',
  });
  res.json({ preferences: next });
});

module.exports = {
  me,
  updateProfile,
  listDocuments,
  uploadDocument,
  documentFile,
  deleteDocument,
  storeDocument,
  publicDocument,
  parseDataUrl,
  securitySettings,
  updateSecurity,
  revokeSession,
  revokeAllSessions,
  activity,
  alertPreferences,
  updateAlertPreferences,
  SELF_EDITABLE,
};
