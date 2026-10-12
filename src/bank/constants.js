'use strict';

/**
 * Everything about the institution that the rest of the bank reads but never
 * decides for itself: who we are, what we sell, what we charge and where the
 * ceilings sit.
 *
 * Values here are the defaults a fresh install boots with. The admin console
 * writes overrides into the `settings` collection, so anything an operator can
 * change at runtime appears in DEFAULT_SETTINGS rather than being hard-coded
 * at the point of use.
 */

/** The institution. Fictional, on a routing prefix the Fed has not assigned. */
const BANK = {
  name: 'Rockfield National Bank',
  shortName: 'Rockfield',
  legalName: 'Rockfield National Bank, N.A.',
  tagline: 'Banking built on bedrock.',
  // ABA checksum valid: 3(8+2+4)+7(1+6+1)+(9+4+7) = 42+56+20 = 118... see
  // validateRouting() in ids.js, which is what actually enforces this.
  routingNumber: '819264176',
  wireRoutingNumber: '819264176',
  swift: 'RKFDUS44XXX',
  fdicCert: '58412',
  nmls: '409127',
  email: 'support@rockfieldglobalfinance.com',
  securityEmail: 'security@rockfieldglobalfinance.com',
  established: 1924,
};

/*
 * The telephone numbers and the postal address are deliberately not here.
 *
 * They are the one part of the institution that is genuinely per-deployment,
 * and a made-up number printed on a live bank's contact page is worse than no
 * number at all: somebody rings it. So they live in DEFAULT_SETTINGS below,
 * blank, and an operator fills them in at the staff console under Settings.
 * Read them through src/bank/contact.js, never from BANK.
 */

/** Deposit and credit products, as they appear in the open-account flows. */
const PRODUCTS = [
  {
    id: 'everyday_checking',
    type: 'checking',
    name: 'Everyday Checking',
    blurb: 'The account the rest of your money moves through.',
    apy: 0.01,
    monthlyFee: 0,
    minimumBalance: 0,
    overdraftLimit: 50000,
    features: ['No monthly service fee', 'Early direct deposit', 'Zelle-style instant sends', '60,000 fee-free ATMs'],
  },
  {
    id: 'premier_checking',
    type: 'checking',
    name: 'Premier Interest Checking',
    blurb: 'Interest-bearing checking for balances that sit still.',
    apy: 0.45,
    monthlyFee: 2500,
    minimumBalance: 250000,
    overdraftLimit: 150000,
    features: ['Waived fee at $2,500', 'Free cashier checks', 'Wire fee rebates', 'Dedicated banker line'],
  },
  {
    id: 'high_yield_savings',
    type: 'savings',
    name: 'High-Yield Savings',
    blurb: 'A rate that actually keeps up, with nothing locked away.',
    apy: 4.35,
    monthlyFee: 0,
    minimumBalance: 0,
    withdrawalLimit: 6,
    features: ['4.35% APY', 'No minimum', 'Automatic round-ups', 'Goal buckets'],
  },
  {
    id: 'money_market',
    type: 'money_market',
    name: 'Money Market',
    blurb: 'Savings rates with check-writing attached.',
    apy: 3.9,
    monthlyFee: 1000,
    minimumBalance: 1000000,
    features: ['Tiered rates', 'Check writing', 'Debit access', 'FDIC insured'],
  },
  {
    id: 'cd_12',
    type: 'cd',
    name: '12-Month Certificate',
    blurb: 'Lock the rate for a year.',
    apy: 4.6,
    termMonths: 12,
    minimumBalance: 100000,
    features: ['Guaranteed rate', 'Auto-renew option', 'Interest paid monthly'],
  },
  {
    id: 'rockfield_signature_card',
    type: 'credit',
    name: 'Rockfield Signature Card',
    blurb: '2% back on everything, no categories to remember.',
    apr: 18.99,
    creditLimit: 1500000,
    features: ['2% unlimited cash back', 'No foreign transaction fee', 'Cell phone protection', 'Zero fraud liability'],
  },
];

/** Account type labels used across statements, transfers and the admin console. */
const ACCOUNT_TYPES = {
  checking: { label: 'Checking', code: 'DDA', sign: 1 },
  savings: { label: 'Savings', code: 'SAV', sign: 1 },
  money_market: { label: 'Money Market', code: 'MMA', sign: 1 },
  cd: { label: 'Certificate of Deposit', code: 'CDA', sign: 1 },
  credit: { label: 'Credit Card', code: 'CCA', sign: -1 },
  loan: { label: 'Loan', code: 'LNA', sign: -1 },
  mortgage: { label: 'Mortgage', code: 'MTG', sign: -1 },
  ira: { label: 'Retirement (IRA)', code: 'IRA', sign: 1 },
};

/** How money moved. Drives the icon, the clearing time and the wording. */
const TRANSACTION_METHODS = {
  internal: { label: 'Internal transfer', clearing: 0 },
  ach: { label: 'ACH transfer', clearing: 1 },
  wire_domestic: { label: 'Domestic wire', clearing: 0 },
  wire_international: { label: 'International wire', clearing: 2 },
  instant: { label: 'Instant send', clearing: 0 },
  card: { label: 'Card purchase', clearing: 1 },
  atm: { label: 'ATM', clearing: 0 },
  check: { label: 'Check', clearing: 2 },
  mobile_deposit: { label: 'Mobile check deposit', clearing: 1 },
  bill_pay: { label: 'Bill payment', clearing: 1 },
  direct_deposit: { label: 'Direct deposit', clearing: 0 },
  fee: { label: 'Fee', clearing: 0 },
  interest: { label: 'Interest', clearing: 0 },
  adjustment: { label: 'Adjustment', clearing: 0 },
  refund: { label: 'Refund', clearing: 1 },
};

/** Spending categories. The dashboard groups the last 30 days by these. */
const CATEGORIES = [
  'Groceries', 'Dining', 'Transport', 'Fuel', 'Travel', 'Utilities', 'Rent & Mortgage',
  'Insurance', 'Healthcare', 'Shopping', 'Entertainment', 'Subscriptions', 'Education',
  'Transfers', 'Income', 'Fees & Interest', 'Taxes', 'Cash & ATM', 'Other',
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
  // Business-day clearing windows shown to the customer.
  clearing: {
    ach: '1-3 business days',
    wireDomestic: 'Same business day if submitted before 4:00pm ET',
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

/** Alert types a customer can switch on or off, grouped for the settings page. */
const ALERT_TYPES = [
  { id: 'login_new_device', group: 'Security', label: 'Sign-in from a new device', default: true, locked: true },
  { id: 'password_changed', group: 'Security', label: 'Password or security settings changed', default: true, locked: true },
  { id: 'profile_changed', group: 'Security', label: 'Profile or contact details changed', default: true },
  { id: 'transfer_submitted', group: 'Money movement', label: 'Transfer submitted', default: true },
  { id: 'transfer_completed', group: 'Money movement', label: 'Transfer completed', default: true },
  { id: 'transfer_rejected', group: 'Money movement', label: 'Transfer returned or rejected', default: true, locked: true },
  { id: 'deposit_posted', group: 'Money movement', label: 'Deposit posted', default: true },
  { id: 'balance_available', group: 'Money movement', label: 'Available balance after money arrives', default: true },
  { id: 'large_transaction', group: 'Money movement', label: 'Transaction over your alert threshold', default: true },
  { id: 'low_balance', group: 'Balances', label: 'Balance falls below your threshold', default: true },
  { id: 'overdraft', group: 'Balances', label: 'Overdraft or returned item', default: true, locked: true },
  { id: 'statement_ready', group: 'Statements', label: 'Monthly statement ready', default: true },
  { id: 'card_activity', group: 'Cards', label: 'Card frozen, replaced or declined', default: true },
  { id: 'account_opened', group: 'Account', label: 'New account opened', default: true },
  { id: 'message_received', group: 'Account', label: 'New secure message', default: true },
  { id: 'marketing', group: 'Account', label: 'Product news and offers', default: false },
];

/** Why an operator or the system stopped a transfer. Shown to the customer verbatim. */
const REJECTION_REASONS = [
  { code: 'insufficient_funds', label: 'Insufficient available funds' },
  { code: 'limit_exceeded', label: 'Exceeds your daily transfer limit' },
  { code: 'beneficiary_unverified', label: 'Beneficiary details could not be verified' },
  { code: 'compliance_review', label: 'Held by compliance review (BSA/AML)' },
  { code: 'ofac_hit', label: 'Sanctions screening requires manual clearance' },
  { code: 'kyc_incomplete', label: 'Identity verification incomplete' },
  { code: 'fraud_suspected', label: 'Suspected fraud - contact the fraud line' },
  { code: 'account_restricted', label: 'Account restricted' },
  { code: 'invalid_routing', label: 'Receiving bank routing number invalid' },
  { code: 'duplicate', label: 'Duplicate of a transfer already submitted' },
  { code: 'customer_request', label: 'Cancelled at the customer’s request' },
  { code: 'other', label: 'Other - see note' },
];

const DOCUMENT_KINDS = [
  { id: 'avatar', label: 'Profile photo' },
  { id: 'id_front', label: 'Government ID (front)' },
  { id: 'id_back', label: 'Government ID (back)' },
  { id: 'ssn_card', label: 'Social Security card' },
  { id: 'proof_address', label: 'Proof of address' },
  { id: 'signature', label: 'Signature card' },
  { id: 'check_front', label: 'Check (front)' },
  { id: 'check_back', label: 'Check (back)' },
  { id: 'w9', label: 'Form W-9' },
  { id: 'other', label: 'Other document' },
];

module.exports = {
  BANK,
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
