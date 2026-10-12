'use strict';

/**
 * The banking API.
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

const router = express.Router();

// Uploads (a profile photo, both sides of a check, an ID) arrive as data URLs.
router.use(express.json({ limit: '8mb' }));

// A signed-in dashboard makes many small calls per screen; sign-in attempts do
// not, so they get their own much tighter bucket below.
router.use(limiter.create({ windowMs: 60_000, max: Number(process.env.BANK_RATE_LIMIT_MAX) || 300, name: 'bank' }));

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
      shortName: BANK.shortName,
      tagline: BANK.tagline,
      routingNumber: cfg.routingNumber || BANK.routingNumber,
      swift: BANK.swift,
      // The contact block is operator-supplied and blank until it is set, so
      // the app can tell "not configured" from "configured as this" and leave
      // the row out rather than print an empty one.
      phone: cfg.supportPhone || '',
      fraudPhone: cfg.fraudPhone || '',
      internationalPhone: cfg.internationalPhone || '',
      email: cfg.supportEmail || BANK.email,
      address: cfg.mailingAddress || '',
      hours: cfg.supportHours || '',
      fdicCert: BANK.fdicCert,
      nmls: BANK.nmls,
      established: BANK.established,
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

router.get('/accounts', accounts.list);
router.get('/accounts/:id', accounts.detail);
router.patch('/accounts/:id', accounts.rename);
router.get('/accounts/:id/statements', accounts.statements);
router.get('/accounts/:id/statements/:period', accounts.statementDetail);

router.get('/transactions', accounts.transactions);
router.get('/transactions/export', accounts.exportTransactions);
router.get('/transactions/:id', accounts.transactionDetail);

router.get('/cards', accounts.cards);
router.post('/cards/:id', accounts.updateCard);

router.get('/transfers/options', money.transferOptions);
router.get('/transfers', money.listTransfers);
router.post('/transfers', money.createTransfer);
router.get('/transfers/:id', money.getTransfer);
router.post('/transfers/:id/verify', money.verifyTransfer);
router.post('/transfers/:id/resend', money.resendTransferCode);
router.post('/transfers/:id/cancel', money.cancelTransfer);

router.get('/beneficiaries', money.listBeneficiaries);
router.post('/beneficiaries', money.createBeneficiary);
router.patch('/beneficiaries/:id', money.updateBeneficiary);
router.delete('/beneficiaries/:id', money.deleteBeneficiary);

router.get('/payees', money.listPayees);
router.post('/payees', money.createPayee);
router.patch('/payees/:id', money.updatePayee);
router.delete('/payees/:id', money.deletePayee);

router.get('/deposits', money.listDeposits);
router.post('/deposits', money.createDeposit);

router.get('/disputes', money.listDisputes);
router.post('/disputes', money.createDispute);

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
staff.get('/settings', admin.getSettings);
staff.put('/settings', admin.updateSettings);
staff.post('/scheduled/run', admin.runScheduled);

staff.get('/customers', admin.listCustomers);
staff.post('/customers', admin.createCustomer);
staff.get('/customers/:id', admin.customerDetail);
staff.patch('/customers/:id', admin.updateCustomer);
staff.post('/customers/:id/status', admin.setCustomerStatus);
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

staff.get('/deposits', admin.listDeposits);
staff.post('/deposits/:id/review', admin.reviewDeposit);

staff.get('/cards', admin.listCards);
staff.post('/cards', admin.issueCard);
staff.patch('/cards/:id', admin.updateCard);

staff.post('/beneficiaries/:id/review', admin.reviewBeneficiary);

staff.get('/activity', admin.listActivity);
staff.get('/activity/export', admin.exportActivity);

staff.get('/alerts', admin.listAlerts);
staff.post('/alerts', admin.sendAlert);

staff.get('/messages', admin.listMessages);
staff.post('/messages/:id/reply', admin.replyToMessage);

staff.get('/disputes', admin.listDisputes);
staff.post('/disputes/:id/resolve', admin.resolveDispute);

router.use('/admin', staff);

module.exports = router;
