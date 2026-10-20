'use strict';

/**
 * Sessions, one-time codes and the middleware that stands in front of every
 * banking route.
 *
 * Sessions are server-side rows. The browser holds an opaque token in an
 * httpOnly cookie and the database holds only its SHA-256 digest, so a session
 * can be listed, shown to the customer as "Chrome on macOS, Columbus OH" and
 * revoked from either side. A second, readable cookie carries a CSRF token
 * that every state-changing request must echo in a header - same-origin fetch
 * can do that and a cross-site form post cannot.
 */

const { db } = require('./db');
const ids = require('./ids');
const security = require('./security');
const settings = require('./settings');
const audit = require('./audit');
const users = require('./users');
const contact = require('./contact');

const SESSION_COOKIE = 'rf_session';
const CSRF_COOKIE = 'rf_csrf';
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------- cookies --- */

function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function isSecureRequest(req) {
  if (process.env.BANK_COOKIE_INSECURE === '1') return false;
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
}

function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
  list.push(cookie);
  res.setHeader('Set-Cookie', list);
}

function setCookie(req, res, name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (isSecureRequest(req)) parts.push('Secure');
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  appendCookie(res, parts.join('; '));
}

function clearCookie(req, res, name) {
  appendCookie(res, `${name}=; Path=/; Max-Age=0; SameSite=Lax${isSecureRequest(req) ? '; Secure' : ''}`);
}

/* ------------------------------------------------------------- sessions --- */

async function createSession(user, req, res, extra = {}) {
  const cfg = await settings.get();
  const token = security.randomToken(32);
  const minutes = Number(cfg.sessionMinutes || 30);
  const device = audit.describeDevice((req.headers && req.headers['user-agent']) || '');
  const session = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: user.id,
    token_hash: security.hashToken(token),
    expires_at: new Date(Date.now() + minutes * 60000).toISOString(),
    last_seen_at: nowIso(),
    ip: audit.clientIp(req),
    user_agent: (req.headers && req.headers['user-agent']) || '',
    device: device.label,
    device_kind: device.kind,
    revoked_at: null,
    remember: Boolean(extra.remember),
  };
  await db.sessions.insert(session);

  const maxAge = extra.remember ? 60 * 60 * 24 * 30 : minutes * 60;
  setCookie(req, res, SESSION_COOKIE, token, { maxAge });
  const csrf = security.randomToken(18);
  await db.sessions.update(session.id, { csrf });
  setCookie(req, res, CSRF_COOKIE, csrf, { maxAge, httpOnly: false });

  return { token, session: { ...session, csrf }, csrf };
}

/*
 * A page asks for three or four things at once as it opens, and each used to
 * look the session and the customer up again: two round trips to the
 * database before any of them could start. A read reuses what this server
 * looked up in the last few seconds. Anything that changes something always
 * looks again, so a revoked session or a suspended customer is never trusted
 * from memory for a change - only, briefly, for a read.
 */
const SESSION_REUSE_MS = 10000;
const recentSessions = new Map(); // token hash -> { at, session, user }
const isRead = (req) => req.method === 'GET' || req.method === 'HEAD';

function forgetSession(hash) {
  if (hash) recentSessions.delete(hash);
  else recentSessions.clear();
}

/** Look up the signed-in customer, sliding the expiry forward as they work. */
async function resolveSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE] || '';
  const header = req.headers['x-hedgestone-session'];
  const raw = token || (typeof header === 'string' ? header : '');
  if (!raw) return null;
  const hash = security.hashToken(raw);

  let session;
  let user;
  const recent = recentSessions.get(hash);
  if (recent && isRead(req) && Date.now() - recent.at < SESSION_REUSE_MS) {
    ({ session, user } = recent);
  } else {
    session = await db.sessions.findOne({ token_hash: hash });
    user = session && !session.revoked_at ? await db.users.findById(session.user_id) : null;
  }
  if (!session || session.revoked_at) { forgetSession(hash); return null; }
  if (session.expires_at && session.expires_at < nowIso()) { forgetSession(hash); return null; }
  if (!user || user.status === 'closed') { forgetSession(hash); return null; }
  if (!isRead(req)) {
    // A change may be to this very customer - a new photo, a new name - so
    // the next read looks them up afresh rather than showing the old one.
    recentSessions.delete(hash);
  } else if (!recent || recent.session !== session) {
    if (recentSessions.size > 5000) recentSessions.clear();
    recentSessions.set(hash, { at: Date.now(), session, user });
  }

  const cfg = await settings.get();
  const minutes = session.remember ? 60 * 24 * 30 : Number(cfg.sessionMinutes || 30);
  const nextExpiry = new Date(Date.now() + minutes * 60000).toISOString();
  // Only write when it actually moves, so reads do not thrash the store.
  let slid = false;
  if (!session.last_seen_at || Date.now() - new Date(session.last_seen_at).getTime() > 60000) {
    await db.sessions.update(session.id, { last_seen_at: nowIso(), expires_at: nextExpiry });
    session.last_seen_at = nowIso();
    session.expires_at = nextExpiry;
    slid = true;
  }
  return { user, session, slid: slid && token ? { token, minutes } : null };
}

async function destroySession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    forgetSession(security.hashToken(token));
    const session = await db.sessions.findOne({ token_hash: security.hashToken(token) });
    if (session) await db.sessions.update(session.id, { revoked_at: nowIso() });
  }
  clearCookie(req, res, SESSION_COOKIE);
  clearCookie(req, res, CSRF_COOKIE);
}

/** Sign every other device out. What "sign out everywhere" does. */
/** Drop what this server remembers of a customer's sessions, so the next request looks them up. */
function forgetUser(userId, keepSessionId) {
  recentSessions.forEach((entry, hash) => {
    if (entry.session.user_id === userId && entry.session.id !== keepSessionId) recentSessions.delete(hash);
  });
}

/** End every session but one, in a single request rather than one per session. */
async function revokeOtherSessions(userId, keepSessionId) {
  forgetUser(userId, keepSessionId);
  const where = { user_id: userId, revoked_at: null };
  if (keepSessionId) where.id = { neq: keepSessionId };
  return db.sessions.updateWhere(where, { revoked_at: nowIso() });
}

/* ----------------------------------------------------------------- OTP --- */

/**
 * Issue a one-time code for a purpose ('login', 'transfer', 'reset').
 *
 * The code is hashed like a password; only the alert email carries the plain
 * value. When email is not configured the code is returned to the caller so
 * local development is not locked out, and that is logged loudly.
 */
async function issueOtp(user, purpose, meta = {}) {
  const cfg = await settings.get();
  const code = ids.otpCode();
  const row = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: user.id,
    purpose,
    code_hash: await security.hashSecret(code),
    expires_at: new Date(Date.now() + Number(cfg.otpMinutes || 10) * 60000).toISOString(),
    attempts: 0,
    used_at: null,
    meta,
  };
  // One live code per purpose: issuing a new one retires the old.
  const live = await db.otps.find({ user_id: user.id, purpose, used_at: null });
  for (const old of live) await db.otps.update(old.id, { used_at: nowIso(), meta: { ...(old.meta || {}), superseded: true } });
  await db.otps.insert(row);
  return { id: row.id, code, expiresAt: row.expires_at };
}

async function verifyOtp(user, purpose, code) {
  const rows = await db.otps.find({ user_id: user.id, purpose, used_at: null }, { order: 'created_at.desc', limit: 1 });
  const row = rows[0];
  if (!row) return { ok: false, reason: 'no_code' };
  if (row.expires_at < nowIso()) return { ok: false, reason: 'expired' };
  if (Number(row.attempts || 0) >= 5) return { ok: false, reason: 'too_many_attempts' };

  const ok = await security.verifySecret(String(code || '').trim(), row.code_hash);
  if (!ok) {
    await db.otps.update(row.id, { attempts: Number(row.attempts || 0) + 1 });
    return { ok: false, reason: 'incorrect' };
  }
  await db.otps.update(row.id, { used_at: nowIso() });
  return { ok: true, otp: row };
}

/* ---------------------------------------------------------- middleware --- */

/** Attach req.bankUser when a session is present. Never rejects. */
async function attach(req, res, next) {
  try {
    const resolved = await resolveSession(req);
    if (resolved) {
      req.bankUser = resolved.user;
      req.bankSession = resolved.session;
      // The server slides a session forward as the customer works, so the
      // cookies must slide with it. They used to keep the lifetime they were
      // issued with, which signed an active customer out exactly thirty
      // minutes after they signed in, mid-task.
      if (resolved.slid) {
        const maxAge = resolved.slid.minutes * 60;
        setCookie(req, res, SESSION_COOKIE, resolved.slid.token, { maxAge });
        if (resolved.session.csrf) setCookie(req, res, CSRF_COOKIE, resolved.session.csrf, { maxAge, httpOnly: false });
      }
    }
  } catch (err) {
    console.warn('[hedgestone] session lookup failed:', err.message);
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.bankUser) {
    return res.status(401).json({ error: 'unauthorized', message: 'Sign in to continue.' });
  }
  if (req.bankUser.status === 'suspended') {
    return res.status(403).json({
      error: 'account_suspended',
      message: `This account is suspended. Please ${contact.callSupport()}.`,
    });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.bankUser) {
    return res.status(401).json({ error: 'unauthorized', message: 'Sign in to continue.' });
  }
  if (req.bankUser.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Administrator access only.' });
  }
  return next();
}

/**
 * Double-submit CSRF check on anything that changes state. The cookie is
 * readable by our own page and by nothing cross-origin, so echoing it in a
 * header proves the request came from us.
 */
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.bankSession) return next(); // unauthenticated posts (sign-in) are rate limited instead
  const sent = req.headers['x-hedgestone-csrf'];
  const expected = req.bankSession.csrf;
  if (!expected) return next();
  if (!sent || !security.timingSafeEqualStr(sent, expected)) {
    return res.status(403).json({ error: 'csrf_failed', message: 'Your session expired. Refresh and try again.' });
  }
  return next();
}

/** Stop everything except sign-out while a password change is outstanding. */
function requirePasswordCurrent(req, res, next) {
  if (req.bankUser && req.bankUser.must_change_password) {
    return res.status(428).json({
      error: 'password_change_required',
      message: 'Choose a new password before continuing.',
    });
  }
  return next();
}

/* --------------------------------------------------------------- login --- */

/**
 * Check an email and password, applying the lockout policy.
 * Returns the user on success, or a reason the caller can log and report.
 */
async function checkCredentials(email, password) {
  const cfg = await settings.get();
  const user = await users.findByEmail(email);
  if (!user) {
    // Same cost as the success path, so timing does not reveal who banks here.
    await security.hashSecret(String(password || ''));
    return { ok: false, reason: 'invalid_credentials' };
  }
  if (user.locked_until && user.locked_until > nowIso()) {
    return { ok: false, reason: 'locked', user, until: user.locked_until };
  }
  if (user.status === 'closed') return { ok: false, reason: 'closed', user };

  const ok = await security.verifySecret(password, user.password_hash);
  if (!ok) {
    const failed = Number(user.failed_logins || 0) + 1;
    const patch = { failed_logins: failed };
    if (failed >= Number(cfg.maxFailedLogins || 5)) {
      patch.locked_until = new Date(Date.now() + Number(cfg.lockoutMinutes || 15) * 60000).toISOString();
      patch.failed_logins = 0;
    }
    await db.users.update(user.id, patch);
    return { ok: false, reason: 'invalid_credentials', user, locked: Boolean(patch.locked_until) };
  }
  if (user.failed_logins) await db.users.update(user.id, { failed_logins: 0, locked_until: null });
  return { ok: true, user };
}

module.exports = {
  forgetUser,
  SESSION_COOKIE,
  CSRF_COOKIE,
  parseCookies,
  setCookie,
  clearCookie,
  createSession,
  resolveSession,
  destroySession,
  revokeOtherSessions,
  forgetSession,
  issueOtp,
  verifyOtp,
  attach,
  requireAuth,
  requireAdmin,
  requirePasswordCurrent,
  csrf,
  checkCredentials,
};
