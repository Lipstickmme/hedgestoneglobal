'use strict';

/**
 * Everything about the platform that the rest of the application reads but
 * never decides for itself: who we are, what we sell, what we charge and where
 * the ceilings sit.
 *
 * Values here are the defaults a fresh install boots with. The admin console
 * writes overrides into the `settings` collection, so anything an operator can
 * change at runtime appears in DEFAULT_SETTINGS rather than being hard-coded
 * at the point of use.
 */

/**
 * The platform. The name here is only the one a fresh install starts with:
 * staff change it at the console under Settings, Platform name, and every
 * page, email and text follows (see public/js/bankname.js).
 *
 * The routing number and SWIFT code are internal plumbing for the ledger and
 * are never shown to a customer.
 */
const BANK = {
  name: 'Hedgestone Finance',
  shortName: 'Hedgestone Finance',
  legalName: 'Hedgestone Finance',
  tagline: 'Invest in Bitcoin, and watch every step of it.',
  // ABA checksum valid: 3(8+2+4)+7(1+6+1)+(9+4+7) = 42+56+20 = 118... see
  // validateRouting() in ids.js, which is what actually enforces this.
  routingNumber: '819264176',
  wireRoutingNumber: '819264176',
  swift: 'HDGSUS44XXX',
  fdicCert: '58412',
  nmls: '409127',
  email: 'support@hedgestonesfinance.com',
  securityEmail: 'security@hedgestonesfinance.com',
  established: 1924,
};

/**
 * Names this application has shipped as its default and since retired. A
 * stored setting holding one of these was written by the seed, not chosen by
 * anyone, so settings.get() reads it as "the default" - see RETIRED in
 * src/utils/siteSettings.js for the same problem with the support address.
 */
const RETIRED_NAMES = ['Hedgestone Global Bank'];

/*
 * The telephone numbers and the postal address are deliberately not here.
 *
 * They are the one part of the institution that is genuinely per-deployment,
 * and a made-up number printed on a live bank's contact page is worse than no
 * number at all: somebody rings it. So they live in DEFAULT_SETTINGS below,
 * blank, and an operator fills them in at the staff console under Settings.
 * Read them through src/bank/contact.js, never from BANK.
 */

/**
 * What a customer can hold. One cash balance - where money waits to buy
 * Bitcoin, and where a sale is paid - and the Bitcoin itself, which lives in
 * the holdings ledger (src/bank/invest.js), not here.
 */
const PRODUCTS = [
  {
    id: 'investment_cash',
    type: 'checking',
    name: 'Cash balance',
    blurb: 'Money waiting to buy Bitcoin, and where the proceeds of a sale are paid.',
    apy: 0,
    monthlyFee: 0,
    minimumBalance: 0,
    overdraftLimit: 0,
    features: ['Buy Bitcoin from $1', 'Sell back to cash at any time', 'Withdraw to your own bank account', 'No monthly fee'],
  },
];

/**
 * Account type labels used across withdrawals and the admin console. Only the
 * cash balance is opened now; the rest stay so older records still read.
 */
const ACCOUNT_TYPES = {
  checking: { label: 'Cash balance', code: 'CSH', sign: 1 },
  savings: { label: 'Cash reserve', code: 'RSV', sign: 1 },
  money_market: { label: 'Cash reserve', code: 'RSV', sign: 1 },
  cd: { label: 'Fixed term', code: 'FIX', sign: 1 },
  credit: { label: 'Credit', code: 'CRD', sign: -1 },
  loan: { label: 'Loan', code: 'LNA', sign: -1 },
  mortgage: { label: 'Loan', code: 'LNA', sign: -1 },
  ira: { label: 'Retirement', code: 'RET', sign: 1 },
};

/**
 * How money moved. Drives the icon, the clearing time and the wording. Older
 * methods are kept so history recorded before Bitcoin-only still reads.
 */
const TRANSACTION_METHODS = {
  internal: { label: 'Between your balances', clearing: 0 },
  ach: { label: 'Standard withdrawal', clearing: 1 },
  wire_domestic: { label: 'Same-day withdrawal', clearing: 0 },
  wire_international: { label: 'International withdrawal', clearing: 2 },
  instant: { label: 'Instant transfer', clearing: 0 },
  card: { label: 'Card payment', clearing: 1 },
  atm: { label: 'Cash withdrawal', clearing: 0 },
  check: { label: 'Cheque', clearing: 2 },
  mobile_deposit: { label: 'Cheque deposit', clearing: 1 },
  bill_pay: { label: 'Bill payment', clearing: 1 },
  direct_deposit: { label: 'Deposit', clearing: 0 },
  fee: { label: 'Fee', clearing: 0 },
  interest: { label: 'Interest', clearing: 0 },
  adjustment: { label: 'Deposit or adjustment', clearing: 0 },
  refund: { label: 'Refund', clearing: 1 },
  investment: { label: 'Bitcoin', clearing: 0 },
  member: { label: 'Transfer from another customer', clearing: 0 },
};

/**
 * Categories an entry can be filed under. The first four are the ones this
 * platform writes; the rest stay so older history still files correctly.
 */
const CATEGORIES = [
  'Deposits', 'Investments', 'Withdrawals', 'Fees & Interest',
  'Income', 'Transfers', 'Taxes', 'Other',
  'Groceries', 'Dining', 'Transport', 'Fuel', 'Travel', 'Utilities', 'Rent & Mortgage',
  'Insurance', 'Healthcare', 'Shopping', 'Entertainment', 'Subscriptions', 'Education', 'Cash & ATM',
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

/**
 * Operator-tunable settings. The admin console edits a copy of this in the
 * `settings` collection; code always reads through settings.get() so an
 * override takes effect without a deploy.
 *
 * Money is in cents everywhere. Floating point dollars do not survive a
 * ledger.
 */
const DEFAULT_SETTINGS = {
  bankName: BANK.name,
  // How long a Bitcoin purchase is planned to be held, in months. The buyer
  // picks one of `investmentTerms` (staff can book any whole number); the
  // dashboard counts down to the date it matures. A maturity date is a plan,
  // not a lock: Bitcoin can still be sold before it.
  investmentTerms: [3, 6, 12, 24],
  investmentTermMonths: 12,
  routingNumber: BANK.routingNumber,
  supportEmail: BANK.email,
  // Blank until an operator sets them at the console. Everything that prints
  // a number checks first and says something sensible when there is none, so
  // a fresh deployment simply has no telephone number rather than a fake one.
  supportPhone: '',
  fraudPhone: '',
  internationalPhone: '',
  mailingAddress: '',
  supportHours: '',
  // Money arriving is announced twice: it has landed, then what can be spent.
  // The second message exists because those are different numbers whenever
  // any part of the balance is on hold. Off makes it one message.
  availableBalanceAlert: true,
  announcement: '',
  announcementLevel: 'info',
  maintenanceMode: false,
  // Verification gates. Each one a transfer must clear before it posts.
  requireOtpForTransfers: true,
  requirePinForTransfers: true,
  holdTransfersForReview: true,
  holdThresholdCents: 1000000,
  // Limits, per calendar day unless noted.
  limits: {
    internalDaily: 5000000,
    achDaily: 2500000,
    wireDaily: 10000000,
    instantDaily: 200000,
    memberDaily: 1000000,
    billPayDaily: 1000000,
    mobileDepositDaily: 500000,
    atmDaily: 100000,
    cardDaily: 750000,
    singleTransactionMax: 25000000,
  },
  // Fees, charged at post time.
  fees: {
    achOutgoing: 0,
    wireDomestic: 2500,
    wireInternational: 4500,
    expeditedTransfer: 1000,
    overdraft: 3400,
    returnedItem: 3400,
    stopPayment: 3000,
    outOfNetworkAtm: 250,
    foreignTransactionPct: 0,
    paperStatement: 200,
    cardReplacement: 0,
    expeditedCardReplacement: 2500,
  },
  // Business-day timings shown to the customer for each kind of withdrawal.
  clearing: {
    ach: '1-3 business days',
    wireDomestic: 'Same business day if requested before 4:00pm ET',
    wireInternational: '2-5 business days',
    mobileDeposit: 'First $225 next business day, remainder in 2 business days',
  },
  sessionMinutes: 30,
  passwordMinLength: 10,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  otpMinutes: 10,
};

/** Security questions offered at enrollment. */
const SECURITY_QUESTIONS = [
  'What was the name of your first school?',
  'In what city were you born?',
  'What was the make of your first car?',
  'What is your mother’s maiden name?',
  'What was the name of your first pet?',
  'What street did you grow up on?',
];

/**
 * Alert types a customer can switch on or off, grouped for the settings page.
 * The last three are only raised by features that have been retired; they
 * stay defined so older alerts still have a label, and are hidden from the
 * preferences list (`retired`).
 */
const ALERT_TYPES = [
  { id: 'login_new_device', group: 'Security', label: 'Sign-in from a new device', default: true, locked: true },
  { id: 'password_changed', group: 'Security', label: 'Password or security settings changed', default: true, locked: true },
  { id: 'profile_changed', group: 'Security', label: 'Profile or contact details changed', default: true },
  { id: 'investment_trade', group: 'Bitcoin', label: 'Bitcoin bought or sold', default: true },
  { id: 'deposit_posted', group: 'Cash', label: 'Money added to your cash balance', default: true },
  { id: 'balance_available', group: 'Cash', label: 'Cash available to invest after money arrives', default: true },
  { id: 'large_transaction', group: 'Cash', label: 'A movement over your alert threshold', default: true },
  { id: 'low_balance', group: 'Cash', label: 'Cash balance falls below your threshold', default: true },
  { id: 'transfer_submitted', group: 'Withdrawals', label: 'Withdrawal requested', default: true },
  { id: 'transfer_completed', group: 'Withdrawals', label: 'Withdrawal sent', default: true },
  { id: 'transfer_rejected', group: 'Withdrawals', label: 'Withdrawal returned', default: true, locked: true },
  { id: 'account_opened', group: 'Account', label: 'New account opened', default: true },
  { id: 'message_received', group: 'Account', label: 'New secure message', default: true },
  { id: 'marketing', group: 'Account', label: 'Product news and offers', default: false },
  { id: 'overdraft', group: 'Account', label: 'Returned item', default: true, locked: true, retired: true },
  { id: 'statement_ready', group: 'Account', label: 'Monthly statement ready', default: false, retired: true },
  { id: 'card_activity', group: 'Account', label: 'Card activity', default: false, retired: true },
];

/** Why an operator or the system stopped a withdrawal. Shown to the customer verbatim. */
const REJECTION_REASONS = [
  { code: 'insufficient_funds', label: 'Insufficient available funds' },
  { code: 'limit_exceeded', label: 'Exceeds your daily withdrawal limit' },
  { code: 'beneficiary_unverified', label: 'Beneficiary details could not be verified' },
  { code: 'compliance_review', label: 'Held by compliance review (BSA/AML)' },
  { code: 'ofac_hit', label: 'Sanctions screening requires manual clearance' },
  { code: 'kyc_incomplete', label: 'Identity verification incomplete' },
  { code: 'fraud_suspected', label: 'Suspected fraud - contact the fraud line' },
  { code: 'account_restricted', label: 'Account restricted' },
  { code: 'invalid_routing', label: 'Receiving account details invalid' },
  { code: 'duplicate', label: 'Duplicate of a withdrawal already requested' },
  { code: 'customer_request', label: 'Cancelled at the customer’s request' },
  { code: 'other', label: 'Other - see note' },
];

const DOCUMENT_KINDS = [
  { id: 'avatar', label: 'Profile photo' },
  { id: 'id_front', label: 'Government ID (front)' },
  { id: 'id_back', label: 'Government ID (back)' },
  { id: 'ssn_card', label: 'Social Security card' },
  { id: 'proof_address', label: 'Proof of address' },
  { id: 'signature', label: 'Signature' },
  { id: 'w9', label: 'Form W-9' },
  { id: 'other', label: 'Other document' },
];

module.exports = {
  BANK,
  RETIRED_NAMES,
  PRODUCTS,
  ACCOUNT_TYPES,
  TRANSACTION_METHODS,
  CATEGORIES,
  US_STATES,
  DEFAULT_SETTINGS,
  SECURITY_QUESTIONS,
  ALERT_TYPES,
  REJECTION_REASONS,
  DOCUMENT_KINDS,
};
