'use strict';

/**
 * The platform's API (mounted at /api/bank, the path it has always had).
 *
 * Ordering matters here in three places and nowhere else:
 *   1. the JSON parser is mounted with a larger ceiling than the rest of the
 *      site, because a photographed check is not a 1MB form post;
 *   2. `attach` runs before everything so req.bankUser exists, and `csrf`
 *      immediately after so no state-changing route can be reached without it;
 *   3. literal paths are declared before their :id siblings.
 */

const express = require('express');

const auth = require('../bank/auth');
const settings = require('../bank/settings');
const seed = require('../bank/seed');
const limiter = require('../middleware/rateLimiter');
const { asyncHandler } = require('../bank/http');
const { BANK, PRODUCTS, ACCOUNT_TYPES } = require('../bank/constants');

const authController = require('../controllers/bank/authController');
const accounts = require('../controllers/bank/accountsController');
const profile = require('../controllers/bank/profileController');
const money = require('../controllers/bank/moneyController');
const messaging = require('../controllers/bank/messagingController');
const admin = require('../controllers/bank/adminController');
const invest = require('../controllers/bank/investController');
const vaultController = require('../controllers/bank/vaultController');
const setupController = require('../controllers/bank/setupController');

const router = express.Router();

// Uploads (a profile photo, both sides of a check, an ID) arrive as data URLs.
router.use(express.json({ limit: '8mb' }));

// A signed-in dashboard makes many small calls per screen; sign-in attempts do
// not, so they get their own much tighter bucket below.
router.use(limiter.create({ windowMs: 60_000, max: Number(process.env.BANK_RATE_LIMIT_MAX) || 300, name: 'bank' }));

// The price feed and its history are the same for everybody and cached at the
// edge, so they answer before any session is looked up: two database round
// trips saved on every page, signed in or not.
/** Live prices for the ticker under the nav. Public, and cached at the edge. */
router.get('/markets', invest.quotes);
/** Daily Bitcoin prices for the dashboard chart. Public, and cached at the edge. */
router.get('/markets/history', invest.history);

router.use(asyncHandler(auth.attach));
router.use(auth.csrf);

/* --------------------------------------------------------- public bits --- */

/** What the sign-in page and the marketing pages need before anyone signs in. */
router.get('/config', asyncHandler(async (req, res) => {
  await seed.ensureSeedOnce();
  const cfg = await settings.get();
  res.json({
    bank: {
      name: cfg.bankName || BANK.name,
      shortName: cfg.bankName || BANK.shortName,
      tagline: BANK.tagline,
      // The contact block is operator-supplied and blank until it is set, so
      // the app can tell "not configured" from "configured as this" and leave
      // the row out rather than print an empty one.
      phone: cfg.supportPhone || '',
      fraudPhone: cfg.fraudPhone || '',
      internationalPhone: cfg.internationalPhone || '',
      email: cfg.supportEmail || BANK.email,
      address: cfg.mailingAddress || '',
      hours: cfg.supportHours || '',
    },
    products: PRODUCTS,
    accountTypes: ACCOUNT_TYPES,
    announcement: cfg.announcement || '',
    announcementLevel: cfg.announcementLevel || 'info',
    maintenanceMode: Boolean(cfg.maintenanceMode),
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    // The sign-in page only offers the demonstration logins where one-time
    // codes are being handed back anyway - that is, never on a deployment.
    devCodes: require('../utils/config').showDevCodes(),
  });
}));

/* ------------------------------------------------------------------ auth --- */

const signInLimiter = limiter.create({
  windowMs: 5 * 60_000,
  max: Number(process.env.BANK_LOGIN_RATE_LIMIT) || 20,
  name: 'bank-auth',
});

router.post('/auth/login', signInLimiter, authController.login);
router.post('/auth/verify', signInLimiter, authController.verify);
router.post('/auth/resend', signInLimiter, authController.resend);
router.post('/auth/forgot', signInLimiter, authController.forgot);
router.post('/auth/reset', signInLimiter, authController.resetPassword);
router.get('/auth/session', authController.session);
router.post('/auth/logout', authController.logout);

// Changing a password is the one authenticated route allowed while a forced
// password change is outstanding.
router.post('/auth/password', auth.requireAuth, authController.changePassword);

/* ------------------------------------------------- everything signed in --- */

router.use(auth.requireAuth);

// A document is served to its owner or to staff; the handler checks which.
router.get('/documents/:id/file', profile.documentFile);

router.use(auth.requirePasswordCurrent);

router.get('/overview', accounts.overview);

router.get('/me', profile.me);
router.patch('/me', profile.updateProfile);
router.get('/me/documents', profile.listDocuments);
router.post('/me/documents', profile.uploadDocument);
router.delete('/me/documents/:id', profile.deleteDocument);
router.get('/me/security', profile.securitySettings);
router.patch('/me/security', profile.updateSecurity);
router.delete('/me/sessions/:id', profile.revokeSession);
router.post('/me/sessions/revoke-all', profile.revokeAllSessions);
router.get('/me/activity', profile.activity);
router.get('/me/alert-preferences', profile.alertPreferences);
router.put('/me/alert-preferences', profile.updateAlertPreferences);

// The vault: what is in it, and requests to receive Bitcoin into it or send it out.
router.get('/invest', invest.portfolio);
router.get('/vault', vaultController.details);
router.post('/vault/receive', vaultController.receive);
router.post('/vault/send', vaultController.send);
router.post('/vault/details-request', vaultController.askForDetails);
router.post('/vault/requests/:id/verify', vaultController.verify);
router.post('/vault/requests/:id/resend', vaultController.resend);
router.post('/vault/requests/:id/cancel', vaultController.cancel);
router.get('/vault/history', vaultController.history);
router.get('/vault/history/export', vaultController.exportHistory);

router.get('/alerts', messaging.listAlerts);
router.post('/alerts/read-all', messaging.readAllAlerts);
router.post('/alerts/:id/read', messaging.readAlert);

router.get('/messages', messaging.listMessages);
router.post('/messages', messaging.sendMessage);
router.post('/messages/:id/read', messaging.readThread);

/* ---------------------------------------------------------------- admin --- */

const staff = express.Router();
staff.use(auth.requireAdmin);

staff.get('/overview', admin.overview);
staff.get('/setup', setupController.setup);
staff.post('/setup/apply', setupController.apply);
staff.get('/investments', invest.staffOverview);
staff.get('/vault/requests', vaultController.staffQueue);
staff.post('/vault/requests/:id/confirm', vaultController.staffConfirm);
staff.post('/vault/requests/:id/reject', vaultController.staffReject);
staff.get('/customers/:id/vault-details', vaultController.staffDetails);
staff.put('/customers/:id/vault-details', vaultController.staffSetDetails);
staff.post('/trades', invest.staffBook);
staff.patch('/trades/:id', invest.staffRetime);
staff.post('/trades/:id/reverse', invest.staffReverse);
staff.get('/settings', admin.getSettings);
staff.put('/settings', admin.updateSettings);
staff.post('/scheduled/run', admin.runScheduled);

staff.get('/customers', admin.listCustomers);
staff.post('/customers', admin.createCustomer);
staff.get('/customers/:id', admin.customerDetail);
staff.get('/customers/:id/investments', invest.staffCustomerHoldings);
staff.patch('/customers/:id', admin.updateCustomer);
staff.post('/customers/:id/status', admin.setCustomerStatus);
staff.delete('/customers/:id', admin.deleteCustomer);
staff.post('/customers/:id/kyc', admin.setKyc);
staff.post('/customers/:id/ssn', admin.revealSsn);
staff.post('/customers/:id/password', admin.resetCustomerPassword);
staff.post('/customers/:id/unlock', admin.unlockCustomer);
staff.post('/customers/:id/documents', admin.uploadCustomerDocument);
staff.post('/customers/:id/accounts', admin.openAccountForCustomer);

staff.patch('/accounts/:id', admin.updateAccount);
staff.post('/accounts/:id/adjust', admin.adjustBalance);

staff.patch('/transactions/:id', admin.updateTransaction);
staff.post('/transactions/:id/settle', admin.settleTransaction);

staff.get('/transfers', admin.listTransfers);
staff.post('/transfers/:id/approve', admin.approveTransfer);
staff.post('/transfers/:id/reject', admin.rejectTransfer);

staff.post('/beneficiaries/:id/review', admin.reviewBeneficiary);

staff.get('/activity', admin.listActivity);
staff.get('/activity/export', admin.exportActivity);

staff.get('/alerts', admin.listAlerts);
staff.post('/alerts', admin.sendAlert);

staff.get('/messages', admin.listMessages);
staff.post('/messages/:id/reply', admin.replyToMessage);

router.use('/admin', staff);

module.exports = router;
