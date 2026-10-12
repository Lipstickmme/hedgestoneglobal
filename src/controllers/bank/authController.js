'use strict';

/**
 * Sign in, verify, sign out, and everything about a password.
 *
 * The sign-in path deliberately says the same thing whether an email is
 * unknown or the password is wrong: telling the internet which addresses bank
 * here is the first step of every credential-stuffing run.
 */

const { db } = require('../../bank/db');
const auth = require('../../bank/auth');
const users = require('../../bank/users');
const security = require('../../bank/security');
const settings = require('../../bank/settings');
const config = require('../../utils/config');
const contact = require('../../bank/contact');
const alerts = require('../../bank/alerts');
const audit = require('../../bank/audit');
const seed = require('../../bank/seed');
const { asyncHandler, fail, trimmed } = require('../../bank/http');
const { BANK } = require('../../bank/constants');

const nowIso = () => new Date().toISOString();

const GENERIC = 'That email address and password do not match an account.';

/** The bank cannot be signed into before it exists. */
async function ready() {
  await seed.ensureSeedOnce();
}

/* --------------------------------------------------------------- login --- */

const login = asyncHandler(async (req, res) => {
  await ready();
  const email = trimmed(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) throw fail(400, 'Enter your email address and password.');

  const result = await auth.checkCredentials(email, password);

  if (!result.ok) {
    if (result.user) {
      await audit.log({
        action: 'auth.login_failed', category: 'security', userId: result.user.id, req, severity: 'warning',
        actor: { id: result.user.id, email, role: result.user.role },
        detail: result.reason === 'locked' ? 'Sign-in blocked: account locked' : 'Incorrect password',
      });
      if (result.locked) {
        await alerts.notifyUser(result.user, 'login_new_device', {
          force: true,
          subject: 'Your Rockfield account is temporarily locked',
          heading: 'Too many sign-in attempts',
          intro: 'We locked online banking for 15 minutes after several incorrect passwords.',
          body: `If this was not you, ${contact.callFraud()} straight away.`,
          severity: 'warning',
        });
      }
    } else {
      await audit.log({
        action: 'auth.login_failed', category: 'security', req, severity: 'warning',
        actor: { email, role: 'anonymous' }, detail: 'Sign-in attempt for an unknown address',
      });
    }
    if (result.reason === 'locked') {
      throw fail(423, 'Too many attempts. Online banking is locked for 15 minutes.', 'locked');
    }
    if (result.reason === 'closed') {
      throw fail(403, `This account is closed. Please ${contact.callSupport()}.`, 'closed');
    }
    throw fail(401, GENERIC, 'invalid_credentials');
  }

  const user = result.user;

  if (user.status === 'suspended') {
    await audit.log({
      action: 'auth.login_blocked', category: 'security', userId: user.id, req, severity: 'warning',
      actor: { id: user.id, email, role: user.role }, detail: 'Sign-in on a suspended account',
    });
    throw fail(403, `This account is suspended. Please ${contact.callSupport()}.`, 'suspended');
  }

  // Second factor, when the customer has it switched on.
  if (user.two_factor_enabled) {
    const { code, expiresAt } = await auth.issueOtp(user, 'login', { ip: audit.clientIp(req) });
    const device = audit.describeDevice(req.headers['user-agent'] || '');
    await alerts.notifyUser(user, 'login_new_device', {
      force: true,
      subject: `Your Rockfield sign-in code: ${code}`,
      heading: 'Your sign-in code',
      intro: `Enter ${code} to finish signing in. It expires in ${(await settings.get()).otpMinutes} minutes.`,
      rows: [
        { label: 'Device', value: device.label },
        { label: 'IP address', value: audit.clientIp(req) || 'unknown' },
        { label: 'Time', value: new Date().toLocaleString('en-US') },
      ],
      footNote: `If this was not you, change your password and ${contact.callFraud()}.`,
    });
    await audit.log({
      action: 'auth.otp_issued', category: 'security', userId: user.id, req,
      actor: { id: user.id, email, role: user.role }, detail: 'Sign-in code sent',
    });
    return res.json({
      status: 'verification_required',
      method: user.two_factor_method || 'email',
      sentTo: security.maskEmail(user.email),
      expiresAt,
      // Without a mail provider the code cannot reach anyone, so it comes back
      // here instead. Off on a deployment, and off once mail is configured.
      devCode: config.showDevCodes() ? code : undefined,
      challengeId: user.id,
    });
  }

  return finishLogin(req, res, user, { remember: Boolean(req.body.remember) });
});

/** Complete a sign-in: session, cookies, alert, activity row. */
async function finishLogin(req, res, user, { remember = false } = {}) {
  const { session, csrf } = await auth.createSession(user, req, res, { remember });
  const device = audit.describeDevice(req.headers['user-agent'] || '');
  const previousIp = user.last_login_ip;

  await db.users.update(user.id, {
    last_login_at: nowIso(),
    last_login_ip: audit.clientIp(req),
    login_count: Number(user.login_count || 0) + 1,
    failed_logins: 0,
    locked_until: null,
  });
  await audit.log({
    action: 'auth.login', category: 'security', userId: user.id, req,
    actor: { id: user.id, email: user.email, role: user.role },
    detail: `Signed in from ${device.label}`,
  });

  // A new IP is the signal customers actually care about.
  if (previousIp && previousIp !== audit.clientIp(req)) {
    await alerts.notifyUser(user, 'login_new_device', {
      subject: 'New sign-in to your Rockfield account',
      heading: 'New sign-in',
      intro: 'Your online banking was opened from a device we have not seen at this address before.',
      rows: [
        { label: 'Device', value: device.label },
        { label: 'IP address', value: audit.clientIp(req) || 'unknown' },
        { label: 'Time', value: new Date().toLocaleString('en-US') },
      ],
      footNote: `Not you? Please ${contact.callFraud()}.`,
    });
  }

  return res.json({
    status: 'ok',
    user: users.publicUser(user, user.role === 'admin' ? 'admin' : 'self'),
    csrf,
    sessionExpiresAt: session.expires_at,
    mustChangePassword: Boolean(user.must_change_password),
    redirect: user.role === 'admin' ? '/console' : '/dashboard',
  });
}

/** Step two of sign-in: the emailed code. */
const verify = asyncHandler(async (req, res) => {
  const email = trimmed(req.body.email, 200).toLowerCase();
  const code = trimmed(req.body.code, 12);
  const user = await users.findByEmail(email);
  if (!user) throw fail(401, GENERIC);

  const result = await auth.verifyOtp(user, 'login', code);
  if (!result.ok) {
    await audit.log({
      action: 'auth.otp_failed', category: 'security', userId: user.id, req, severity: 'warning',
      actor: { id: user.id, email, role: user.role }, detail: `Sign-in code rejected (${result.reason})`,
    });
    const message = result.reason === 'expired' ? 'That code has expired. Sign in again to get a new one.'
      : result.reason === 'too_many_attempts' ? 'Too many attempts. Sign in again to get a new code.'
        : 'That code is not correct.';
    throw fail(400, message, result.reason);
  }
  return finishLogin(req, res, user, { remember: Boolean(req.body.remember) });
});

/** Send the sign-in code again. */
const resend = asyncHandler(async (req, res) => {
  const user = await users.findByEmail(trimmed(req.body.email, 200));
  if (!user) throw fail(401, GENERIC);
  const { code, expiresAt } = await auth.issueOtp(user, 'login', {});
  await alerts.notifyUser(user, 'login_new_device', {
    force: true,
    subject: `Your Rockfield sign-in code: ${code}`,
    heading: 'Your sign-in code',
    intro: `Enter ${code} to finish signing in.`,
  });
  res.json({ status: 'sent', expiresAt, devCode: config.showDevCodes() ? code : undefined });
});

const logout = asyncHandler(async (req, res) => {
  if (req.bankUser) {
    await audit.log({
      action: 'auth.logout', category: 'security', userId: req.bankUser.id, req,
      actor: { id: req.bankUser.id, email: req.bankUser.email, role: req.bankUser.role },
      detail: 'Signed out',
    });
  }
  await auth.destroySession(req, res);
  res.json({ status: 'ok' });
});

/** Who am I, and is my session still good? The app calls this on every load. */
const session = asyncHandler(async (req, res) => {
  await ready();
  if (!req.bankUser) return res.json({ authenticated: false });
  const cfg = await settings.get();
  const unread = await alerts.unreadCount(req.bankUser.id);
  const unreadMessages = (await db.messages.find({ user_id: req.bankUser.id, from_side: 'bank', read_at: null })).length;
  res.json({
    authenticated: true,
    user: users.publicUser(req.bankUser, req.bankUser.role === 'admin' ? 'admin' : 'self'),
    csrf: req.bankSession && req.bankSession.csrf,
    expiresAt: req.bankSession && req.bankSession.expires_at,
    mustChangePassword: Boolean(req.bankUser.must_change_password),
    unreadAlerts: unread,
    unreadMessages,
    announcement: cfg.announcement || '',
    announcementLevel: cfg.announcementLevel || 'info',
    maintenanceMode: Boolean(cfg.maintenanceMode),
  });
});

/* ------------------------------------------------------------ password --- */

const changePassword = asyncHandler(async (req, res) => {
  const user = req.bankUser;
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  const cfg = await settings.get();

  // A forced change (a temporary password from the console) has nothing to
  // confirm against beyond the password they just signed in with.
  const ok = await security.verifySecret(current, user.password_hash);
  if (!ok) throw fail(400, 'Your current password is not correct.');

  const problems = security.passwordProblems(next, { minLength: cfg.passwordMinLength });
  if (problems.length) throw fail(400, `Choose a stronger password: ${problems.join(', ').toLowerCase()}.`, 'weak_password');
  if (await security.verifySecret(next, user.password_hash)) {
    throw fail(400, 'Choose a password you have not used here before.');
  }

  await db.users.update(user.id, {
    password_hash: await security.hashSecret(next),
    must_change_password: false,
    password_changed_at: nowIso(),
    updated_at: nowIso(),
  });
  const revoked = await auth.revokeOtherSessions(user.id, req.bankSession && req.bankSession.id);
  await audit.log({
    action: 'security.password_changed', category: 'security', userId: user.id, req, severity: 'notice',
    actor: { id: user.id, email: user.email, role: user.role },
    detail: `Password changed; ${revoked} other session(s) signed out`,
  });
  await alerts.notifyUser(user, 'password_changed', {
    subject: 'Your Rockfield password was changed',
    heading: 'Your password was changed',
    intro: 'This is confirmation that the password for your online banking has just been changed.',
    rows: [
      { label: 'When', value: new Date().toLocaleString('en-US') },
      { label: 'Device', value: audit.describeDevice(req.headers['user-agent'] || '').label },
      { label: 'Other sessions signed out', value: String(revoked) },
    ],
    footNote: `If this was not you, ${contact.callFraud()} immediately.`,
  });
  res.json({ status: 'ok', signedOutSessions: revoked });
});

/**
 * Start a reset. Always answers the same way: whether the address banks here
 * is not a question this endpoint will answer.
 */
const forgot = asyncHandler(async (req, res) => {
  await ready();
  const email = trimmed(req.body.email, 200).toLowerCase();
  const user = await users.findByEmail(email);
  if (user) {
    const { code } = await auth.issueOtp(user, 'reset', { ip: audit.clientIp(req) });
    await alerts.notifyUser(user, 'password_changed', {
      force: true,
      subject: 'Reset your Rockfield password',
      heading: 'Reset your password',
      intro: `Use code ${code} to set a new password. It expires shortly.`,
      footNote: `If you did not ask for this, ignore this email and ${contact.callFraud()} if you are concerned.`,
    });
    await audit.log({
      action: 'security.reset_requested', category: 'security', userId: user.id, req,
      actor: { id: user.id, email, role: user.role }, detail: 'Password reset code sent',
    });
    // A reset code returned here is a reset code for whoever asked, so it is
    // only ever offered where nobody but the developer can be asking.
    if (config.showDevCodes()) {
      console.log(`[rockfield] password reset code for ${email}: ${code}`);
      return res.json({ status: 'sent', devCode: code });
    }
  }
  res.json({ status: 'sent' });
});

const resetPassword = asyncHandler(async (req, res) => {
  const email = trimmed(req.body.email, 200).toLowerCase();
  const code = trimmed(req.body.code, 12);
  const next = String(req.body.newPassword || '');
  const user = await users.findByEmail(email);
  if (!user) throw fail(400, 'That code is not valid.');

  const result = await auth.verifyOtp(user, 'reset', code);
  if (!result.ok) throw fail(400, 'That code is not valid.', result.reason);

  const cfg = await settings.get();
  const problems = security.passwordProblems(next, { minLength: cfg.passwordMinLength });
  if (problems.length) throw fail(400, `Choose a stronger password: ${problems.join(', ').toLowerCase()}.`, 'weak_password');

  await db.users.update(user.id, {
    password_hash: await security.hashSecret(next),
    must_change_password: false,
    password_changed_at: nowIso(),
    failed_logins: 0,
    locked_until: null,
    updated_at: nowIso(),
  });
  await auth.revokeOtherSessions(user.id, null);
  await audit.log({
    action: 'security.password_reset', category: 'security', userId: user.id, req, severity: 'notice',
    actor: { id: user.id, email, role: user.role }, detail: 'Password reset with an emailed code',
  });
  await alerts.notifyUser(user, 'password_changed', {
    subject: 'Your Rockfield password was reset',
    heading: 'Your password was reset',
    intro: 'Your online banking password has just been reset and every other session was signed out.',
    footNote: `If this was not you, ${contact.callFraud()} immediately.`,
  });
  res.json({ status: 'ok' });
});

module.exports = { login, verify, resend, logout, session, changePassword, forgot, resetPassword };
