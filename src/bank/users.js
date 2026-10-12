'use strict';

/**
 * Customer and staff records: how one is made, how one is found, and exactly
 * how much of one may leave the server.
 *
 * The shaping functions matter as much as the creation ones. A user row holds
 * a password hash, an encrypted SSN, a transfer PIN hash and security answers;
 * publicUser() is the gate that decides what a browser is allowed to see, and
 * every controller returns through it rather than sending a row straight out.
 */

const { db } = require('./db');
const ids = require('./ids');
const security = require('./security');
const { ALERT_TYPES } = require('./constants');

const nowIso = () => new Date().toISOString();

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

function fullName(user) {
  if (!user) return '';
  return [user.first_name, user.middle_name, user.last_name].filter(Boolean).join(' ');
}

function initials(user) {
  const first = (user && user.first_name) || '';
  const last = (user && user.last_name) || '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || 'RF';
}

function defaultAlertPrefs() {
  const out = {};
  ALERT_TYPES.forEach((t) => { out[t.id] = t.default; });
  return out;
}

/**
 * Create a customer or an administrator.
 *
 * Only the admin console calls this in production - Rockfield opens accounts
 * for people, it does not let the internet open them for itself - so the
 * caller is trusted to have validated the input; what happens here is the
 * hashing, the encryption and the defaults.
 */
async function createUser(input = {}) {
  const email = normalizeEmail(input.email);
  if (!email) throw Object.assign(new Error('An email address is required.'), { status: 400 });

  const existing = await findByEmail(email);
  if (existing) throw Object.assign(new Error('That email address already has an account.'), { status: 409 });

  const password = input.password || `Rf${security.randomToken(6)}!9`;
  const user = {
    id: ids.uuid(),
    created_at: nowIso(),
    updated_at: nowIso(),
    customer_number: input.customerNumber || ids.customerNumber(),
    role: input.role === 'admin' ? 'admin' : 'customer',
    status: input.status || 'active',
    email,
    email_verified: Boolean(input.emailVerified),
    password_hash: await security.hashSecret(password),
    must_change_password: input.mustChangePassword !== false && input.role !== 'admin',
    password_changed_at: nowIso(),

    first_name: String(input.firstName || '').trim(),
    middle_name: String(input.middleName || '').trim(),
    last_name: String(input.lastName || '').trim(),
    preferred_name: String(input.preferredName || '').trim(),
    date_of_birth: input.dateOfBirth || '',
    ssn_encrypted: input.ssn ? security.encrypt(String(input.ssn).replace(/\D/g, '')) : '',
    ssn_last4: input.ssn ? String(input.ssn).replace(/\D/g, '').slice(-4) : '',
    tax_id_type: input.taxIdType || 'SSN',
    citizenship: input.citizenship || 'US',
    id_type: input.idType || '',
    id_number: input.idNumber ? security.encrypt(input.idNumber) : '',
    id_state: input.idState || '',
    id_expires: input.idExpires || '',

    phone: String(input.phone || '').trim(),
    mobile: String(input.mobile || '').trim(),
    address_line1: String(input.addressLine1 || '').trim(),
    address_line2: String(input.addressLine2 || '').trim(),
    city: String(input.city || '').trim(),
    state: String(input.state || '').trim(),
    postal_code: String(input.postalCode || '').trim(),
    country: input.country || 'United States',
    mailing_same_as_home: input.mailingSameAsHome !== false,

    employment_status: input.employmentStatus || '',
    employer: input.employer || '',
    occupation: input.occupation || '',
    annual_income: Number(input.annualIncome || 0),
    source_of_funds: input.sourceOfFunds || '',

    photo_url: input.photoUrl || '',
    photo_document_id: null,

    kyc_status: input.kycStatus || 'pending',
    kyc_notes: input.kycNotes || '',
    kyc_reviewed_at: null,
    risk_rating: input.riskRating || 'standard',
    tier: input.tier || 'Standard',
    relationship_manager: input.relationshipManager || '',

    two_factor_enabled: input.twoFactorEnabled !== false,
    two_factor_method: input.twoFactorMethod || 'email',
    transfer_pin_hash: input.transferPin ? await security.hashSecret(input.transferPin) : '',
    security_question: input.securityQuestion || '',
    security_answer_hash: input.securityAnswer ? await security.hashSecret(String(input.securityAnswer).trim().toLowerCase()) : '',

    alert_prefs: input.alertPrefs || defaultAlertPrefs(),
    alert_threshold: Number(input.alertThreshold || 50000),
    low_balance_threshold: Number(input.lowBalanceThreshold || 10000),
    paperless: input.paperless !== false,
    language: input.language || 'en-US',
    timezone: input.timezone || 'America/New_York',

    failed_logins: 0,
    locked_until: null,
    last_login_at: null,
    last_login_ip: '',
    login_count: 0,
    opened_by: input.openedBy || null,
    notes: input.notes || '',
  };

  await db.users.insert(user);
  return { user, temporaryPassword: input.password ? null : password };
}

function findByEmail(email) {
  return db.users.findOne({ email: normalizeEmail(email) });
}

/**
 * The shape a browser receives.
 *
 * `level` decides how much: 'self' for the signed-in customer, 'admin' for the
 * console (which may see the SSN's last four and the KYC file), and 'summary'
 * for lists. Nothing anywhere returns a hash.
 */
function publicUser(user, level = 'self') {
  if (!user) return null;
  const base = {
    id: user.id,
    customerNumber: user.customer_number,
    role: user.role,
    status: user.status,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    firstName: user.first_name,
    middleName: user.middle_name,
    lastName: user.last_name,
    preferredName: user.preferred_name,
    fullName: fullName(user),
    initials: initials(user),
    photoUrl: user.photo_url || '',
    tier: user.tier,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
  if (level === 'summary') return base;

  const detail = {
    ...base,
    dateOfBirth: user.date_of_birth,
    ssnMasked: user.ssn_last4 ? `•••-••-${user.ssn_last4}` : '',
    ssnLast4: user.ssn_last4,
    taxIdType: user.tax_id_type,
    citizenship: user.citizenship,
    idType: user.id_type,
    idState: user.id_state,
    idExpires: user.id_expires,
    phone: user.phone,
    mobile: user.mobile,
    addressLine1: user.address_line1,
    addressLine2: user.address_line2,
    city: user.city,
    state: user.state,
    postalCode: user.postal_code,
    country: user.country,
    employmentStatus: user.employment_status,
    employer: user.employer,
    occupation: user.occupation,
    annualIncome: user.annual_income,
    sourceOfFunds: user.source_of_funds,
    kycStatus: user.kyc_status,
    riskRating: user.risk_rating,
    relationshipManager: user.relationship_manager,
    twoFactorEnabled: Boolean(user.two_factor_enabled),
    twoFactorMethod: user.two_factor_method,
    hasTransferPin: Boolean(user.transfer_pin_hash),
    securityQuestion: user.security_question,
    alertPrefs: user.alert_prefs || defaultAlertPrefs(),
    alertThreshold: user.alert_threshold,
    lowBalanceThreshold: user.low_balance_threshold,
    paperless: Boolean(user.paperless),
    language: user.language,
    timezone: user.timezone,
    mustChangePassword: Boolean(user.must_change_password),
    passwordChangedAt: user.password_changed_at,
    loginCount: user.login_count,
    lastLoginIp: user.last_login_ip,
  };
  if (level !== 'admin') return detail;

  return {
    ...detail,
    kycNotes: user.kyc_notes,
    kycReviewedAt: user.kyc_reviewed_at,
    failedLogins: user.failed_logins,
    lockedUntil: user.locked_until,
    notes: user.notes,
    openedBy: user.opened_by,
    updatedAt: user.updated_at,
  };
}

/** The full SSN, for the one screen in the console that is allowed to show it. */
function revealSsn(user) {
  return user && user.ssn_encrypted ? security.formatSsn(security.decrypt(user.ssn_encrypted)) : '';
}

/** Field names the admin console may patch, mapped to their column. */
const EDITABLE = {
  firstName: 'first_name',
  middleName: 'middle_name',
  lastName: 'last_name',
  preferredName: 'preferred_name',
  email: 'email',
  phone: 'phone',
  mobile: 'mobile',
  dateOfBirth: 'date_of_birth',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  state: 'state',
  postalCode: 'postal_code',
  country: 'country',
  employmentStatus: 'employment_status',
  employer: 'employer',
  occupation: 'occupation',
  annualIncome: 'annual_income',
  sourceOfFunds: 'source_of_funds',
  tier: 'tier',
  riskRating: 'risk_rating',
  relationshipManager: 'relationship_manager',
  kycStatus: 'kyc_status',
  kycNotes: 'kyc_notes',
  status: 'status',
  notes: 'notes',
  idType: 'id_type',
  idState: 'id_state',
  idExpires: 'id_expires',
  citizenship: 'citizenship',
  taxIdType: 'tax_id_type',
  language: 'language',
  timezone: 'timezone',
  photoUrl: 'photo_url',
};

/** Build a column patch from a camelCase body, ignoring anything not listed. */
function patchFromBody(body = {}, allowed = EDITABLE) {
  const patch = {};
  Object.entries(allowed).forEach(([key, column]) => {
    if (body[key] === undefined) return;
    patch[column] = typeof body[key] === 'string' ? body[key].trim() : body[key];
  });
  if (patch.email) patch.email = normalizeEmail(patch.email);
  if (Object.keys(patch).length) patch.updated_at = nowIso();
  return patch;
}

module.exports = {
  createUser,
  findByEmail,
  publicUser,
  revealSsn,
  patchFromBody,
  fullName,
  initials,
  normalizeEmail,
  defaultAlertPrefs,
  EDITABLE,
};
