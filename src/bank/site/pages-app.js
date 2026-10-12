'use strict';

/**
 * The signed-in application and the sign-in pages.
 *
 * Each page is a skeleton: the structure, the empty states and the forms are
 * in the HTML, and the numbers arrive from /api/bank once the page is up. The
 * containers carry data- attributes rather than ids where more than one of a
 * thing can exist, which is what the scripts look for.
 */

const { appPage, authPage, icon, dateField } = require('./layout');
const { BANK, US_STATES, CATEGORIES, SECURITY_QUESTIONS, DOCUMENT_KINDS } = require('../constants');

const option = (value, label) => `<option value="${value}">${label || value}</option>`;
const stateOptions = US_STATES.map((s) => option(s)).join('');

/* ================================================================ sign in == */

const signinContent = `
      <div class="rf-auth-box">
        <h1>Sign in to online banking</h1>
        <p class="lede">Your session ends after 30 minutes of inactivity.</p>

        <div class="rf-card">
          <div class="rf-card-body">
            <div class="rf-notice rf-hide" data-announcement></div>

            <form id="rf-signin-form" novalidate>
              <div class="rf-field">
                <label for="rf-email">Email address</label>
                <input class="rf-input" type="email" id="rf-email" name="email" autocomplete="username" required />
              </div>
              <div class="rf-field">
                <label for="rf-password">Password</label>
                <input class="rf-input" type="password" id="rf-password" name="password" autocomplete="current-password" required />
              </div>
              <label class="rf-check">
                <input type="checkbox" name="remember" />
                <span>Keep me signed in on this device</span>
              </label>
              <div class="rf-notice bad rf-hide" data-form-error></div>
              <button class="rf-btn block" type="submit" data-submit>Sign in</button>
            </form>

            <form id="rf-verify-form" class="rf-hide" novalidate>
              <p class="rf-small rf-muted">We sent a six-digit code to <strong data-sent-to></strong>. It expires in ten minutes.</p>
              <div class="rf-field">
                <label class="rf-label" for="rf-code-0">Verification code</label>
                <div class="rf-otp" data-otp>
                  <input id="rf-code-0" inputmode="numeric" maxlength="1" autocomplete="one-time-code" />
                  <input inputmode="numeric" maxlength="1" />
                  <input inputmode="numeric" maxlength="1" />
                  <input inputmode="numeric" maxlength="1" />
                  <input inputmode="numeric" maxlength="1" />
                  <input inputmode="numeric" maxlength="1" />
                </div>
              </div>
              <div class="rf-devcode rf-hide" data-dev-code></div>
              <div class="rf-notice bad rf-hide" data-form-error></div>
              <button class="rf-btn block" type="submit" data-submit>Verify and continue</button>
              <div class="rf-auth-alt">
                <button type="button" class="rf-btn link" data-resend>Send a new code</button> &middot;
                <button type="button" class="rf-btn link" data-back>Start again</button>
              </div>
            </form>
          </div>
        </div>

        <div class="rf-auth-alt">
          <a href="/forgot">Forgotten your password?</a> &middot;
          <a href="/open-account">Open an account</a>
        </div>

        <div class="rf-card rf-mt rf-hide" data-demo-card>
          <div class="rf-card-body tight rf-small">
            <strong>Demonstration sign-ins</strong>
            <div class="rf-spread rf-mt" style="margin-top:8px">
              <span>Customer &mdash; <code class="rf-mono">demo@rockfieldglobalfinance.com</code> / <code class="rf-mono">Bedrock#Demo2026</code></span>
              <button class="rf-btn ghost sm" data-fill="customer">Use</button>
            </div>
            <div class="rf-spread" style="margin-top:8px">
              <span>Administrator &mdash; <code class="rf-mono">admin@rockfieldglobalfinance.com</code> / <code class="rf-mono">Rockfield#Admin2026</code></span>
              <button class="rf-btn ghost sm" data-fill="admin">Use</button>
            </div>
          </div>
        </div>
      </div>`;

const forgotContent = `
      <div class="rf-auth-box">
        <h1>Reset your password</h1>
        <p class="lede">We will email a code to the address on your account.</p>
        <div class="rf-card">
          <div class="rf-card-body">
            <form id="rf-forgot-form" novalidate>
              <div class="rf-field">
                <label for="rf-forgot-email">Email address</label>
                <input class="rf-input" type="email" id="rf-forgot-email" name="email" autocomplete="username" required />
              </div>
              <div class="rf-notice bad rf-hide" data-form-error></div>
              <button class="rf-btn block" type="submit" data-submit>Send a reset code</button>
            </form>

            <form id="rf-reset-form" class="rf-hide" novalidate>
              <div class="rf-devcode rf-hide" data-dev-code></div>
              <div class="rf-field">
                <label for="rf-reset-code">Reset code</label>
                <input class="rf-input mono" id="rf-reset-code" name="code" inputmode="numeric" maxlength="6" required />
              </div>
              <div class="rf-field">
                <label for="rf-new-password">New password</label>
                <input class="rf-input" type="password" id="rf-new-password" name="newPassword" autocomplete="new-password" required />
                <div class="hint">At least 10 characters, with upper and lower case, a number and a symbol.</div>
              </div>
              <div class="rf-field">
                <label for="rf-confirm-password">Confirm new password</label>
                <input class="rf-input" type="password" id="rf-confirm-password" name="confirm" autocomplete="new-password" required />
              </div>
              <div class="rf-notice bad rf-hide" data-form-error></div>
              <button class="rf-btn block" type="submit" data-submit>Set my new password</button>
            </form>
          </div>
        </div>
        <div class="rf-auth-alt"><a href="/signin">Back to sign in</a></div>
      </div>`;

const changePasswordContent = `
      <div class="rf-auth-box">
        <h1>Choose a new password</h1>
        <p class="lede">Your password was set by ${BANK.shortName}. Pick your own before you carry on.</p>
        <div class="rf-card">
          <div class="rf-card-body">
            <form id="rf-change-form" novalidate>
              <div class="rf-field">
                <label for="rf-current">Current password</label>
                <input class="rf-input" type="password" id="rf-current" name="currentPassword" autocomplete="current-password" required />
              </div>
              <div class="rf-field">
                <label for="rf-next">New password</label>
                <input class="rf-input" type="password" id="rf-next" name="newPassword" autocomplete="new-password" required />
                <div class="hint">At least 10 characters, with upper and lower case, a number and a symbol.</div>
              </div>
              <div class="rf-field">
                <label for="rf-next-confirm">Confirm new password</label>
                <input class="rf-input" type="password" id="rf-next-confirm" name="confirm" autocomplete="new-password" required />
              </div>
              <div class="rf-notice bad rf-hide" data-form-error></div>
              <button class="rf-btn block" type="submit" data-submit>Save and continue</button>
            </form>
          </div>
        </div>
      </div>`;

/* ============================================================== dashboard == */

const dashboardContent = `
        <div class="rf-grid cols-4 rf-mb" data-totals>
          <div class="rf-card rf-stat"><div class="k">Total on deposit</div><div class="v" data-total="deposits">&mdash;</div><div class="d" data-total-sub="deposits">across your accounts</div></div>
          <div class="rf-card rf-stat"><div class="k">Available now</div><div class="v" data-total="available">&mdash;</div><div class="d">after holds and pending items</div></div>
          <div class="rf-card rf-stat"><div class="k">Card balance</div><div class="v" data-total="owed">&mdash;</div><div class="d" data-total-sub="owed">&nbsp;</div></div>
          <div class="rf-card rf-stat"><div class="k">Credit available</div><div class="v" data-total="creditAvailable">&mdash;</div><div class="d">to spend on your card</div></div>
        </div>

        <div class="rf-grid side">
          <div class="rf-stack">
            <section>
              <div class="rf-spread rf-mb">
                <h2 style="font-family:var(--rf-display);font-size:17px;margin:0">Your accounts</h2>
                <a class="rf-btn ghost sm" href="/accounts">All accounts</a>
              </div>
              <div class="rf-grid cols-2" data-accounts>
                <div class="rf-card rf-stat"><div class="rf-skel" style="width:60%"></div><div class="rf-skel rf-mt" style="width:40%;height:24px"></div></div>
                <div class="rf-card rf-stat"><div class="rf-skel" style="width:60%"></div><div class="rf-skel rf-mt" style="width:40%;height:24px"></div></div>
              </div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head">
                <h3>Recent activity</h3>
                <div class="rf-card-actions"><a class="rf-btn ghost sm" href="/transactions">See all</a></div>
              </div>
              <div class="rf-table-wrap">
                <table class="rf-table">
                  <thead><tr><th>Date</th><th>Description</th><th class="opt">Account</th><th></th><th class="num">Amount</th><th class="num opt">Balance</th></tr></thead>
                  <tbody data-recent><tr><td colspan="6" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
                </table>
              </div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Money in and out</h3><div class="rf-card-actions rf-small rf-muted">Last six months</div></div>
              <div class="rf-card-body"><div class="rf-bars" data-months></div>
                <div class="rf-inline rf-mt rf-small rf-muted">
                  <span class="rf-inline"><i style="width:10px;height:10px;border-radius:3px;background:var(--rf-credit);display:inline-block"></i> In</span>
                  <span class="rf-inline"><i style="width:10px;height:10px;border-radius:3px;background:var(--rf-navy-3);display:inline-block"></i> Out</span>
                </div>
              </div>
            </section>
          </div>

          <div class="rf-stack">
            <section class="rf-card">
              <div class="rf-card-head"><h3>Move money</h3></div>
              <div class="rf-card-body rf-stack" style="gap:9px">
                <a class="rf-btn block" href="/transfers">${icon('transfer', 16)} Make a transfer</a>
                <a class="rf-btn ghost block" href="/deposit">${icon('deposit', 16)} Deposit a check</a>
                <a class="rf-btn ghost block" href="/bills">${icon('bill', 16)} Pay a bill</a>
                <a class="rf-btn ghost block" href="/recipients">${icon('people', 16)} Manage recipients</a>
              </div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Spending</h3><div class="rf-card-actions rf-small rf-muted">30 days</div></div>
              <div class="rf-card-body"><div class="rf-ring" data-spending></div></div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Pending</h3></div>
              <ul class="rf-list" data-pending><li class="rf-muted rf-small">Nothing pending.</li></ul>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Coming up</h3></div>
              <ul class="rf-list" data-upcoming><li class="rf-muted rf-small">No scheduled payments.</li></ul>
            </section>
          </div>
        </div>`;

/* =============================================================== accounts == */

const accountsContent = `
        <div class="rf-grid cols-2" data-accounts></div>

        <section class="rf-card rf-mt" data-account-detail hidden>
          <div class="rf-card-head">
            <h3 data-detail-title>Account</h3>
            <div class="rf-card-actions">
              <button class="rf-btn ghost sm" data-rename>Rename</button>
              <a class="rf-btn ghost sm" data-statements-link href="/statements">Statements</a>
              <button class="rf-btn ghost sm" data-close-detail>Close</button>
            </div>
          </div>
          <div class="rf-card-body">
            <div class="rf-grid cols-2">
              <div>
                <dl class="rf-dl" data-detail-dl></dl>
              </div>
              <div>
                <h4 class="rf-label">Direct deposit and wire details</h4>
                <dl class="rf-dl" data-detail-wire></dl>
                <button class="rf-btn ghost sm rf-mt" data-copy-details>Copy details</button>
              </div>
            </div>
            <hr class="rf-divider" />
            <h4 class="rf-label">Latest entries</h4>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Date</th><th>Description</th><th></th><th class="num">Amount</th><th class="num opt">Balance</th></tr></thead>
                <tbody data-detail-transactions></tbody>
              </table>
            </div>
          </div>
        </section>`;

/* =========================================================== transactions == */

const transactionsContent = `
        <section class="rf-card rf-mb">
          <div class="rf-card-body tight">
            <form class="rf-row four" data-filters style="align-items:end">
              <div class="rf-field" style="margin:0">
                <label for="f-q">Search</label>
                <input class="rf-input" id="f-q" name="q" placeholder="Merchant, description, reference" />
              </div>
              <div class="rf-field" style="margin:0">
                <label for="f-account">Account</label>
                <select class="rf-select" id="f-account" name="accountId"><option value="">All accounts</option></select>
              </div>
              <div class="rf-field" style="margin:0">
                <label for="f-category">Category</label>
                <select class="rf-select" id="f-category" name="category"><option value="">All categories</option>${CATEGORIES.map((c) => option(c)).join('')}</select>
              </div>
              <div class="rf-field" style="margin:0">
                <label for="f-direction">Direction</label>
                <select class="rf-select" id="f-direction" name="direction"><option value="">Money in and out</option><option value="credit">Money in</option><option value="debit">Money out</option></select>
              </div>
              ${dateField({ id: 'f-from', name: 'from', label: 'From', from: -10, to: 0, wrapClass: 'rf-field rf-field-flush' })}
              ${dateField({ id: 'f-to', name: 'to', label: 'To', from: -10, to: 0, wrapClass: 'rf-field rf-field-flush' })}
              <div class="rf-field" style="margin:0">
                <label for="f-status">Status</label>
                <select class="rf-select" id="f-status" name="status"><option value="">Any status</option><option value="posted">Posted</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="reversed">Reversed</option></select>
              </div>
              <div class="rf-inline">
                <button class="rf-btn sm" type="submit">Apply</button>
                <button class="rf-btn ghost sm" type="reset">Clear</button>
                <a class="rf-btn ghost sm" data-export href="/api/bank/transactions/export">Export CSV</a>
              </div>
            </form>
          </div>
        </section>

        <section class="rf-card">
          <div class="rf-card-head">
            <h3>Transactions</h3>
            <div class="rf-card-actions rf-small rf-muted" data-count></div>
          </div>
          <div class="rf-table-wrap">
            <table class="rf-table">
              <thead><tr><th>Date</th><th>Description</th><th class="opt">Category</th><th class="opt">Account</th><th>Status</th><th class="num">Amount</th><th class="num opt">Balance</th></tr></thead>
              <tbody data-rows><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
            </table>
          </div>
          <div class="rf-card-foot rf-spread">
            <span data-range></span>
            <span class="rf-inline">
              <button class="rf-btn ghost sm" data-prev>Previous</button>
              <button class="rf-btn ghost sm" data-next>Next</button>
            </span>
          </div>
        </section>`;

/* ============================================================== transfers == */

const transfersContent = `
        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head"><h3>Send money</h3></div>
            <div class="rf-card-body">
              <div class="rf-segment rf-mb" data-type-picker></div>

              <form id="rf-transfer-form" novalidate>
                <div class="rf-field">
                  <label for="t-from">From</label>
                  <select class="rf-select" id="t-from" name="fromAccountId" required></select>
                  <div class="hint" data-available></div>
                </div>

                <div class="rf-field" data-to-internal hidden>
                  <label for="t-to">To</label>
                  <select class="rf-select" id="t-to" name="toAccountId"></select>
                </div>

                <div class="rf-field" data-to-beneficiary hidden>
                  <label for="t-beneficiary">Recipient</label>
                  <select class="rf-select" id="t-beneficiary" name="beneficiaryId"></select>
                  <div class="hint"><a href="/recipients">Add or manage recipients</a></div>
                </div>

                <div class="rf-field" data-to-payee hidden>
                  <label for="t-payee">Payee</label>
                  <select class="rf-select" id="t-payee" name="payeeId"></select>
                  <div class="hint"><a href="/bills">Add or manage payees</a></div>
                </div>

                <div class="rf-row">
                  <div class="rf-field">
                    <label for="t-amount">Amount</label>
                    <input class="rf-input money" id="t-amount" name="amount" inputmode="decimal" placeholder="0.00" required />
                  </div>
                  ${dateField({ id: 't-date', name: 'scheduledFor', label: 'Send on', from: 0, to: 3, order: 'asc', hint: 'Leave blank to send now.' })}
                </div>

                <div class="rf-row">
                  <div class="rf-field">
                    <label for="t-recurrence">Repeat</label>
                    <select class="rf-select" id="t-recurrence" name="recurrence">
                      <option value="none">One time</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every two weeks</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div class="rf-field" data-pin-field hidden>
                    <label for="t-pin">Transfer PIN</label>
                    <input class="rf-input mono" id="t-pin" name="pin" inputmode="numeric" maxlength="6" autocomplete="off" />
                  </div>
                </div>

                <div class="rf-field">
                  <label for="t-memo">Memo <span class="rf-muted">(optional)</span></label>
                  <input class="rf-input" id="t-memo" name="memo" maxlength="140" placeholder="What is this for?" />
                </div>

                <div class="rf-notice" data-summary></div>
                <div class="rf-notice bad rf-hide" data-form-error></div>
                <button class="rf-btn block" type="submit" data-submit>Review and send</button>
              </form>
            </div>
          </section>

          <div class="rf-stack">
            <section class="rf-card">
              <div class="rf-card-head"><h3>Limits today</h3></div>
              <ul class="rf-list" data-limits></ul>
            </section>
            <section class="rf-card">
              <div class="rf-card-head"><h3>How long it takes</h3></div>
              <div class="rf-card-body rf-small rf-muted" data-clearing></div>
            </section>
          </div>
        </div>

        <section class="rf-card rf-mt">
          <div class="rf-card-head">
            <h3>Transfer history</h3>
            <div class="rf-card-actions">
              <select class="rf-select" data-status-filter style="width:auto">
                <option value="">All statuses</option>
                <option value="pending_review">In review</option>
                <option value="pending_verification">Awaiting code</option>
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="rejected">Returned</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div class="rf-table-wrap">
            <table class="rf-table">
              <thead><tr><th>Date</th><th>Recipient</th><th class="opt">Type</th><th class="opt">Confirmation</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead>
              <tbody data-transfers><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
            </table>
          </div>
        </section>`;

/* ============================================================= recipients == */

const recipientsContent = `
        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head">
              <h3>Saved recipients</h3>
              <div class="rf-card-actions rf-small rf-muted" data-count></div>
            </div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Recipient</th><th class="opt">Bank</th><th>Account</th><th class="opt">Type</th><th>Status</th><th></th></tr></thead>
                <tbody data-rows><tr><td colspan="6" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
          </section>

          <section class="rf-card">
            <div class="rf-card-head"><h3>Add a recipient</h3></div>
            <div class="rf-card-body">
              <form id="rf-beneficiary-form" novalidate>
                <div class="rf-field">
                  <label for="b-type">Payment type</label>
                  <select class="rf-select" id="b-type" name="type">
                    <option value="domestic_ach">ACH transfer (US)</option>
                    <option value="domestic_wire">Domestic wire (US)</option>
                    <option value="international_wire">International wire</option>
                  </select>
                </div>
                <div class="rf-field">
                  <label for="b-name">Name on the account</label>
                  <input class="rf-input" id="b-name" name="name" required />
                </div>
                <div class="rf-field">
                  <label for="b-nickname">Nickname <span class="rf-muted">(optional)</span></label>
                  <input class="rf-input" id="b-nickname" name="nickname" placeholder="Mum, landlord, plumber" />
                </div>
                <div class="rf-field">
                  <label for="b-bank">Receiving bank</label>
                  <input class="rf-input" id="b-bank" name="bankName" />
                </div>
                <div class="rf-field">
                  <label for="b-account">Account number</label>
                  <input class="rf-input mono" id="b-account" name="accountNumber" required />
                </div>
                <div class="rf-field" data-routing-field>
                  <label for="b-routing">Routing number (ABA)</label>
                  <input class="rf-input mono" id="b-routing" name="routingNumber" inputmode="numeric" maxlength="9" />
                  <div class="hint">Nine digits. We check it before we save it.</div>
                </div>
                <div class="rf-field rf-hide" data-swift-field>
                  <label for="b-swift">SWIFT / BIC</label>
                  <input class="rf-input mono" id="b-swift" name="swift" maxlength="11" />
                </div>
                <div class="rf-field rf-hide" data-country-field>
                  <label for="b-country">Country</label>
                  <input class="rf-input" id="b-country" name="country" />
                </div>
                <div class="rf-row">
                  <div class="rf-field">
                    <label for="b-account-type">Account type</label>
                    <select class="rf-select" id="b-account-type" name="accountType">
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                      <option value="business">Business</option>
                    </select>
                  </div>
                  <div class="rf-field">
                    <label for="b-relationship">Relationship</label>
                    <input class="rf-input" id="b-relationship" name="relationship" placeholder="Family, supplier" />
                  </div>
                </div>
                <div class="rf-notice bad rf-hide" data-form-error></div>
                <button class="rf-btn block" type="submit" data-submit>Save recipient</button>
              </form>
            </div>
          </section>
        </div>`;

/* ================================================================== bills == */

const billsContent = `
        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head"><h3>Payees</h3></div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Payee</th><th class="opt">Category</th><th class="opt">Account</th><th>Due</th><th class="num">Amount</th><th class="opt-sm">Autopay</th><th></th></tr></thead>
                <tbody data-rows><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
          </section>

          <section class="rf-card">
            <div class="rf-card-head"><h3>Add a payee</h3></div>
            <div class="rf-card-body">
              <form id="rf-payee-form" novalidate>
                <div class="rf-field">
                  <label for="p-name">Company</label>
                  <input class="rf-input" id="p-name" name="name" required />
                </div>
                <div class="rf-field">
                  <label for="p-category">Category</label>
                  <select class="rf-select" id="p-category" name="category">
                    ${['Utilities', 'Insurance', 'Rent & Mortgage', 'Healthcare', 'Education', 'Subscriptions', 'Other'].map((c) => option(c)).join('')}
                  </select>
                </div>
                <div class="rf-field">
                  <label for="p-account">Account number with them</label>
                  <input class="rf-input mono" id="p-account" name="accountNumber" />
                </div>
                <div class="rf-row">
                  <div class="rf-field">
                    <label for="p-amount">Usual amount</label>
                    <input class="rf-input" id="p-amount" name="amount" inputmode="decimal" placeholder="0.00" />
                  </div>
                  <div class="rf-field">
                    <label for="p-due">Due day</label>
                    <input class="rf-input" id="p-due" name="dueDay" type="number" min="1" max="28" value="1" />
                  </div>
                </div>
                <label class="rf-check"><input type="checkbox" name="autopay" /><span>Pay this automatically each month</span></label>
                <div class="rf-notice bad rf-hide" data-form-error></div>
                <button class="rf-btn block" type="submit" data-submit>Save payee</button>
              </form>
            </div>
          </section>
        </div>`;

/* ================================================================ deposit == */

const depositContent = `
        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head"><h3>Deposit a check</h3></div>
            <div class="rf-card-body">
              <div class="rf-notice">
                <span>${icon('check', 17)}</span>
                <span><strong>Before you start</strong>Endorse the back of the check and write &ldquo;For mobile deposit at ${BANK.shortName} only&rdquo; under your signature. Keep the check for 14 days after it clears.</span>
              </div>

              <form id="rf-deposit-form" novalidate>
                <div class="rf-row">
                  <div class="rf-field">
                    <label for="d-account">Deposit into</label>
                    <select class="rf-select" id="d-account" name="accountId" required></select>
                  </div>
                  <div class="rf-field">
                    <label for="d-amount">Amount on the check</label>
                    <input class="rf-input money" id="d-amount" name="amount" inputmode="decimal" placeholder="0.00" required />
                  </div>
                </div>
                <div class="rf-row">
                  <div class="rf-field">
                    <label for="d-check-number">Check number</label>
                    <input class="rf-input mono" id="d-check-number" name="checkNumber" maxlength="10" />
                  </div>
                  <div class="rf-field">
                    <label for="d-memo">Memo <span class="rf-muted">(optional)</span></label>
                    <input class="rf-input" id="d-memo" name="memo" maxlength="140" />
                  </div>
                </div>

                <div class="rf-row">
                  <div class="rf-field">
                    <label>Front of the check</label>
                    <label class="rf-card" style="display:block;padding:18px;text-align:center;cursor:pointer;border-style:dashed">
                      <input type="file" accept="image/*" capture="environment" data-image="front" hidden />
                      <span data-preview="front" class="rf-small rf-muted">Tap to photograph the front</span>
                    </label>
                  </div>
                  <div class="rf-field">
                    <label>Back of the check</label>
                    <label class="rf-card" style="display:block;padding:18px;text-align:center;cursor:pointer;border-style:dashed">
                      <input type="file" accept="image/*" capture="environment" data-image="back" hidden />
                      <span data-preview="back" class="rf-small rf-muted">Tap to photograph the back</span>
                    </label>
                  </div>
                </div>

                <div class="rf-notice bad rf-hide" data-form-error></div>
                <button class="rf-btn block" type="submit" data-submit>Deposit check</button>
              </form>
            </div>
          </section>

          <section class="rf-card">
            <div class="rf-card-head"><h3>Recent deposits</h3></div>
            <ul class="rf-list" data-deposits><li class="rf-muted rf-small">No mobile deposits yet.</li></ul>
          </section>
        </div>`;

/* ================================================================== cards == */

const cardsContent = `
        <div class="rf-grid cols-2" data-cards></div>
        <p class="rf-small rf-muted rf-mt">Card numbers are never shown in full online. Call <span data-site="phone">us</span> if you need the full number, or report a card lost or stolen at any time - a replacement goes out the same day.</p>`;

/* ============================================================= statements == */

const statementsContent = `
        <section class="rf-card rf-mb">
          <div class="rf-card-body tight rf-inline">
            <label class="rf-label" for="s-account" style="margin:0">Account</label>
            <select class="rf-select" id="s-account" style="width:auto;min-width:260px"></select>
            <span class="rf-muted rf-small">Statements are kept for seven years. Paper copies cost $2.00 each.</span>
          </div>
        </section>

        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head"><h3>Statement periods</h3></div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Period</th><th class="num opt">Opening</th><th class="num opt">In</th><th class="num opt">Out</th><th class="num">Closing</th><th></th></tr></thead>
                <tbody data-rows><tr><td colspan="6" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
          </section>
          <section class="rf-card">
            <div class="rf-card-head"><h3>Paperless</h3></div>
            <div class="rf-card-body rf-small rf-muted">
              You are signed up for paperless statements. We email you when each one is ready and keep it here for seven years.
              <a class="rf-btn ghost sm rf-mt" href="/profile">Change this</a>
            </div>
          </section>
        </div>

        <section class="rf-card rf-mt" data-statement hidden>
          <div class="rf-card-head rf-no-print">
            <h3 data-statement-title>Statement</h3>
            <div class="rf-card-actions">
              <button class="rf-btn ghost sm" onclick="window.print()">Print or save as PDF</button>
              <button class="rf-btn ghost sm" data-close-statement>Close</button>
            </div>
          </div>
          <div class="rf-card-body"><div data-statement-body></div></div>
        </section>`;

/* ================================================================ alerts == */

const alertsContent = `
        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head">
              <h3>Notifications</h3>
              <div class="rf-card-actions"><button class="rf-btn ghost sm" data-read-all>Mark all as read</button></div>
            </div>
            <ul class="rf-list" data-rows><li class="rf-muted rf-small">Loading&hellip;</li></ul>
          </section>

          <section class="rf-card">
            <div class="rf-card-head"><h3>What we tell you about</h3></div>
            <div class="rf-card-body">
              <form id="rf-alert-prefs" data-prefs></form>
              <hr class="rf-divider" />
              <div class="rf-row">
                <div class="rf-field">
                  <label for="a-threshold">Alert me over</label>
                  <input class="rf-input" id="a-threshold" name="alertThreshold" inputmode="decimal" />
                </div>
                <div class="rf-field">
                  <label for="a-low">Low balance below</label>
                  <input class="rf-input" id="a-low" name="lowBalanceThreshold" inputmode="decimal" />
                </div>
              </div>
              <button class="rf-btn" data-save-prefs>Save preferences</button>
            </div>
          </section>
        </div>`;

/* ============================================================== messages == */

const messagesContent = `
        <div class="rf-grid side-left">
          <section class="rf-card">
            <div class="rf-card-head">
              <h3>Conversations</h3>
              <div class="rf-card-actions"><button class="rf-btn sm" data-new>New</button></div>
            </div>
            <ul class="rf-list" data-threads><li class="rf-muted rf-small">Loading&hellip;</li></ul>
          </section>

          <section class="rf-card">
            <div class="rf-card-head"><h3 data-thread-subject>Secure message</h3></div>
            <div class="rf-card-body" data-thread>
              <p class="rf-muted rf-small">Choose a conversation, or start a new one. Messages here are inside your banking session, so it is safe to include account details.</p>
            </div>
            <div class="rf-card-foot">
              <form id="rf-message-form">
                <div class="rf-field rf-hide" data-subject-field>
                  <label for="m-subject">Subject</label>
                  <input class="rf-input" id="m-subject" name="subject" maxlength="140" />
                </div>
                <div class="rf-field">
                  <textarea class="rf-textarea" name="body" placeholder="Write your message" required></textarea>
                </div>
                <button class="rf-btn" type="submit" data-submit>Send securely</button>
              </form>
            </div>
          </section>
        </div>`;

/* ============================================================== security == */

const securityContent = `
        <div class="rf-grid side">
          <div class="rf-stack">
            <section class="rf-card">
              <div class="rf-card-head"><h3>Password</h3></div>
              <div class="rf-card-body">
                <p class="rf-small rf-muted" data-password-changed></p>
                <form id="rf-password-form" novalidate>
                  <div class="rf-row">
                    <div class="rf-field">
                      <label for="s-current">Current password</label>
                      <input class="rf-input" type="password" id="s-current" name="currentPassword" autocomplete="current-password" required />
                    </div>
                    <div class="rf-field">
                      <label for="s-new">New password</label>
                      <input class="rf-input" type="password" id="s-new" name="newPassword" autocomplete="new-password" required />
                    </div>
                  </div>
                  <div class="rf-notice bad rf-hide" data-form-error></div>
                  <button class="rf-btn" type="submit" data-submit>Change password</button>
                </form>
              </div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Verification</h3></div>
              <div class="rf-card-body">
                <div class="rf-switch">
                  <span class="t">Two-step verification<small>A code by email every time you sign in.</small></span>
                  <input type="checkbox" data-toggle="twoFactorEnabled" />
                </div>
                <hr class="rf-divider" />
                <form id="rf-pin-form" novalidate>
                  <div class="rf-row">
                    <div class="rf-field">
                      <label for="s-pin">Transfer PIN</label>
                      <input class="rf-input mono" id="s-pin" name="transferPin" inputmode="numeric" maxlength="6" placeholder="4 to 6 digits" />
                    </div>
                    <div class="rf-field">
                      <label for="s-current-pin">Current PIN or password</label>
                      <input class="rf-input" type="password" id="s-current-pin" name="currentPin" autocomplete="off" />
                    </div>
                  </div>
                  <button class="rf-btn ghost" type="submit" data-submit>Save PIN</button>
                </form>
                <hr class="rf-divider" />
                <form id="rf-question-form" novalidate>
                  <div class="rf-field">
                    <label for="s-question">Security question</label>
                    <select class="rf-select" id="s-question" name="securityQuestion">${SECURITY_QUESTIONS.map((q) => option(q)).join('')}</select>
                  </div>
                  <div class="rf-field">
                    <label for="s-answer">Answer</label>
                    <input class="rf-input" id="s-answer" name="securityAnswer" autocomplete="off" />
                  </div>
                  <button class="rf-btn ghost" type="submit" data-submit>Save question</button>
                </form>
              </div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Recent security activity</h3><div class="rf-card-actions"><a class="rf-btn ghost sm" href="/activity">Full history</a></div></div>
              <ul class="rf-list" data-activity><li class="rf-muted rf-small">Loading&hellip;</li></ul>
            </section>
          </div>

          <div class="rf-stack">
            <section class="rf-card">
              <div class="rf-card-head">
                <h3>Where you are signed in</h3>
                <div class="rf-card-actions"><button class="rf-btn ghost sm" data-revoke-all>Sign out everywhere</button></div>
              </div>
              <ul class="rf-list" data-sessions><li class="rf-muted rf-small">Loading&hellip;</li></ul>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>If something looks wrong</h3></div>
              <div class="rf-card-body rf-small">
                <p>Call the fraud line<span data-site-row="fraudPhone" hidden> on <strong data-site="fraudPhone"></strong></span>, day or night. We will never call you and ask for your password, a one-time code or your full card number.</p>
                <a class="rf-btn ghost sm" href="/cards">Freeze a card</a>
              </div>
            </section>
          </div>
        </div>`;

/* ================================================================ activity == */

const activityContent = `
        <section class="rf-card">
          <div class="rf-card-head"><h3>Account activity</h3><div class="rf-card-actions rf-small rf-muted">Everything done on your account, with the device and address it came from</div></div>
          <div class="rf-table-wrap">
            <table class="rf-table">
              <thead><tr><th>When</th><th>What happened</th><th>Category</th><th class="opt">Device</th><th class="opt">IP address</th></tr></thead>
              <tbody data-rows><tr><td colspan="5" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
            </table>
          </div>
        </section>`;

/* ================================================================= profile == */

const profileContent = `
        <div class="rf-grid side">
          <div class="rf-stack">
            <section class="rf-card">
              <div class="rf-card-head"><h3>Your details</h3></div>
              <div class="rf-card-body">
                <form id="rf-profile-form" novalidate>
                  <div class="rf-row">
                    <div class="rf-field"><label>Legal name</label><input class="rf-input" data-readonly="fullName" readonly /></div>
                    <div class="rf-field"><label for="pr-preferred">Preferred name</label><input class="rf-input" id="pr-preferred" name="preferredName" /></div>
                  </div>
                  <div class="rf-row">
                    <div class="rf-field"><label>Date of birth</label><input class="rf-input" data-readonly="dateOfBirth" readonly /></div>
                    <div class="rf-field"><label>Social Security number</label><input class="rf-input mono" data-readonly="ssnMasked" readonly /></div>
                  </div>
                  <div class="rf-row">
                    <div class="rf-field"><label>Email (username)</label><input class="rf-input" data-readonly="email" readonly /></div>
                    <div class="rf-field"><label for="pr-phone">Phone</label><input class="rf-input" id="pr-phone" name="phone" /></div>
                  </div>
                  <hr class="rf-divider" />
                  <div class="rf-field"><label for="pr-address1">Address</label><input class="rf-input" id="pr-address1" name="addressLine1" /></div>
                  <div class="rf-field"><label for="pr-address2">Apartment, suite <span class="rf-muted">(optional)</span></label><input class="rf-input" id="pr-address2" name="addressLine2" /></div>
                  <div class="rf-row three">
                    <div class="rf-field"><label for="pr-city">City</label><input class="rf-input" id="pr-city" name="city" /></div>
                    <div class="rf-field"><label for="pr-state">State</label><select class="rf-select" id="pr-state" name="state">${stateOptions}</select></div>
                    <div class="rf-field"><label for="pr-zip">ZIP</label><input class="rf-input mono" id="pr-zip" name="postalCode" maxlength="10" /></div>
                  </div>
                  <hr class="rf-divider" />
                  <div class="rf-row">
                    <div class="rf-field"><label for="pr-employment">Employment</label>
                      <select class="rf-select" id="pr-employment" name="employmentStatus">
                        ${['Employed', 'Self-employed', 'Retired', 'Student', 'Not employed'].map((e) => option(e)).join('')}
                      </select>
                    </div>
                    <div class="rf-field"><label for="pr-employer">Employer</label><input class="rf-input" id="pr-employer" name="employer" /></div>
                  </div>
                  <div class="rf-field"><label for="pr-occupation">Occupation</label><input class="rf-input" id="pr-occupation" name="occupation" /></div>
                  <div class="rf-notice bad rf-hide" data-form-error></div>
                  <button class="rf-btn" type="submit" data-submit>Save changes</button>
                  <p class="rf-small rf-muted rf-mt">To change your legal name, date of birth or Social Security number, call <span data-site="phone">us</span>. We need to see a document first.</p>
                </form>
              </div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Documents on file</h3></div>
              <ul class="rf-list" data-documents><li class="rf-muted rf-small">Loading&hellip;</li></ul>
              <div class="rf-card-foot">
                <form id="rf-document-form" class="rf-inline">
                  <select class="rf-select" name="kind" style="width:auto">${DOCUMENT_KINDS.filter((k) => k.id !== 'avatar').map((k) => option(k.id, k.label)).join('')}</select>
                  <input type="file" name="file" accept="image/*,application/pdf" class="rf-input" style="width:auto" />
                  <button class="rf-btn sm" type="submit" data-submit>Upload</button>
                </form>
              </div>
            </section>
          </div>

          <div class="rf-stack">
            <section class="rf-card">
              <div class="rf-card-head"><h3>Photo</h3></div>
              <div class="rf-card-body rf-center">
                <span class="rf-avatar lg" data-user-avatar style="margin:0 auto 12px">RF</span>
                <label class="rf-btn ghost sm" style="cursor:pointer">
                  <input type="file" accept="image/*" data-avatar hidden /> Upload a photo
                </label>
                <p class="rf-small rf-muted rf-mt">JPEG or PNG, up to 6MB. It appears here and in the console when we help you.</p>
              </div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Your relationship</h3></div>
              <div class="rf-card-body"><dl class="rf-dl" data-relationship></dl></div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Statements and mail</h3></div>
              <div class="rf-card-body">
                <div class="rf-switch">
                  <span class="t">Paperless statements<small>Email me instead of posting paper.</small></span>
                  <input type="checkbox" data-toggle="paperless" />
                </div>
              </div>
            </section>
          </div>
        </div>`;

module.exports = [
  {
    file: 'signin.html',
    build: authPage,
    opts: { title: `Sign in | ${BANK.name}`, description: 'Sign in to Rockfield National Bank online banking.', content: signinContent, extraScripts: ['/js/bank/signin.js'] },
  },
  {
    file: 'forgot.html',
    build: authPage,
    opts: { title: `Reset your password | ${BANK.name}`, description: 'Reset your Rockfield online banking password.', content: forgotContent, extraScripts: ['/js/bank/signin.js'] },
  },
  {
    file: 'change-password.html',
    build: authPage,
    opts: { title: `Choose a new password | ${BANK.name}`, description: 'Set a new password for online banking.', content: changePasswordContent, extraScripts: ['/js/bank/signin.js'] },
  },
  {
    file: 'dashboard.html',
    build: appPage,
    opts: {
      title: `Dashboard | ${BANK.name}`, description: 'Your accounts at a glance.',
      heading: 'Good to see you', sub: 'Here is where your money stands today.',
      active: 'dashboard', content: dashboardContent, extraScripts: ['/js/bank/app.js'],
      actions: '<a class="rf-btn sm" href="/transfers">Send money</a>',
    },
  },
  {
    file: 'accounts.html',
    build: appPage,
    opts: {
      title: `Accounts | ${BANK.name}`, description: 'Your accounts.',
      heading: 'Accounts', sub: 'Balances, account numbers and wire details.',
      active: 'accounts', content: accountsContent, extraScripts: ['/js/bank/app.js'],
    },
  },
  {
    file: 'transactions.html',
    build: appPage,
    opts: {
      title: `Transactions | ${BANK.name}`, description: 'Search and filter your transactions.',
      heading: 'Transactions', sub: 'Everything in and out, across every account.',
      active: 'transactions', content: transactionsContent, extraScripts: ['/js/bank/app.js'],
    },
  },
  {
    file: 'statements.html',
    build: appPage,
    opts: {
      title: `Statements | ${BANK.name}`, description: 'Monthly statements.',
      heading: 'Statements', sub: 'Twelve months, ready to print or save.',
      active: 'statements', content: statementsContent, extraScripts: ['/js/bank/app.js'],
    },
  },
  {
    file: 'transfers.html',
    build: appPage,
    opts: {
      title: `Transfers | ${BANK.name}`, description: 'Send money between accounts, by ACH or by wire.',
      heading: 'Transfers', sub: 'Between your accounts, to someone else, or out by wire.',
      active: 'transfers', content: transfersContent, extraScripts: ['/js/bank/money.js'],
    },
  },
  {
    file: 'recipients.html',
    build: appPage,
    opts: {
      title: `Recipients | ${BANK.name}`, description: 'The people and companies you send money to.',
      heading: 'Recipients', sub: 'Saved details for the people you pay.',
      active: 'recipients', content: recipientsContent, extraScripts: ['/js/bank/money.js'],
    },
  },
  {
    file: 'bills.html',
    build: appPage,
    opts: {
      title: `Bill pay | ${BANK.name}`, description: 'Pay bills and manage payees.',
      heading: 'Bill pay', sub: 'Payees, due dates and autopay.',
      active: 'bills', content: billsContent, extraScripts: ['/js/bank/money.js'],
    },
  },
  {
    file: 'deposit.html',
    build: appPage,
    opts: {
      title: `Deposit a check | ${BANK.name}`, description: 'Deposit a check with your phone.',
      heading: 'Deposit a check', sub: 'Photograph both sides and we will do the rest.',
      active: 'deposit', content: depositContent, extraScripts: ['/js/bank/money.js'],
    },
  },
  {
    file: 'cards.html',
    build: appPage,
    opts: {
      title: `Cards | ${BANK.name}`, description: 'Freeze a card, set limits, report one lost.',
      heading: 'Cards', sub: 'Freeze, unfreeze, set limits or report a card lost.',
      active: 'cards', content: cardsContent, extraScripts: ['/js/bank/app.js'],
    },
  },
  {
    file: 'alerts.html',
    build: appPage,
    opts: {
      title: `Alerts | ${BANK.name}`, description: 'Your notifications and what we tell you about.',
      heading: 'Alerts', sub: 'Every notification we have sent, and what triggers them.',
      active: 'alerts', content: alertsContent, extraScripts: ['/js/bank/app.js'],
    },
  },
  {
    file: 'messages.html',
    build: appPage,
    opts: {
      title: `Messages | ${BANK.name}`, description: 'Secure messages with the bank.',
      heading: 'Secure messages', sub: 'Inside your session, so account details are safe to send.',
      active: 'messages', content: messagesContent, extraScripts: ['/js/bank/app.js'],
    },
  },
  {
    file: 'security.html',
    build: appPage,
    opts: {
      title: `Security | ${BANK.name}`, description: 'Password, verification and signed-in devices.',
      heading: 'Security', sub: 'Password, two-step verification, transfer PIN and devices.',
      active: 'security', content: securityContent, extraScripts: ['/js/bank/profile.js'],
    },
  },
  {
    file: 'activity.html',
    build: appPage,
    opts: {
      title: `Activity | ${BANK.name}`, description: 'Everything done on your account.',
      heading: 'Activity', sub: 'A full history, with the device and address behind each entry.',
      active: 'security', content: activityContent, extraScripts: ['/js/bank/profile.js'],
    },
  },
  {
    file: 'profile.html',
    build: appPage,
    opts: {
      title: `Profile | ${BANK.name}`, description: 'Your details, documents and photo.',
      heading: 'Profile', sub: 'Contact details, documents and your photo.',
      active: 'profile', content: profileContent, extraScripts: ['/js/bank/profile.js'],
    },
  },
];
