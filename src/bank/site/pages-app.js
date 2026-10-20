'use strict';

/**
 * The signed-in application and the sign-in pages.
 *
 * Each page is a skeleton: the structure, the empty states and the forms are
 * in the HTML, and the numbers arrive from /api/bank once the page is up. The
 * containers carry data- attributes rather than ids where more than one of a
 * thing can exist, which is what the scripts look for.
 */

const { appPage, authPage, icon, dateField, RISK } = require('./layout');
const { BANK, US_STATES, CATEGORIES, SECURITY_QUESTIONS, DOCUMENT_KINDS } = require('../constants');

const option = (value, label) => `<option value="${value}">${label || value}</option>`;
const stateOptions = US_STATES.map((s) => option(s)).join('');

/* ================================================================ sign in == */

const signinContent = `
      <div class="rf-auth-box">
        <h1>Sign in to your investment</h1>
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
          <a href="/open-account">Start investing</a>
        </div>

        <div class="rf-card rf-mt rf-hide" data-demo-card>
          <div class="rf-card-body tight rf-small">
            <strong>Demonstration sign-ins</strong>
            <div class="rf-spread rf-mt" style="margin-top:8px">
              <span>Customer &mdash; <code class="rf-mono">demo@hedgestonesfinance.com</code> / <code class="rf-mono">Bedrock#Demo2026</code></span>
              <button class="rf-btn ghost sm" data-fill="customer">Use</button>
            </div>
            <div class="rf-spread" style="margin-top:8px">
              <span>Administrator &mdash; <code class="rf-mono">admin@hedgestonesfinance.com</code> / <code class="rf-mono">Hedgestone#Admin2026</code></span>
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
        <p class="lede">Your password was set by ${BANK.name}. Pick your own before you carry on.</p>
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

/*
 * The dashboard is the investment: what the Bitcoin is worth, what went into
 * it, how it has grown since the day it was bought, and how long each purchase
 * has left to maturity. Cash comes second, as what is left to invest.
 * public/js/bank/app.js fills every [data-*] below from /invest, /overview and
 * /markets/history.
 */
const dashboardContent = `
        <section class="hs-dash-hero hs-btc-hero rf-mb">
          <div class="hs-dash-hero-main">
            <span class="k">${icon('bitcoin', 16)} Your Bitcoin investment</span>
            <strong class="v" data-hero="value">&mdash;</strong>
            <span class="d">
              <span>Invested <b data-hero="cost">&mdash;</b></span>
              <span>Growth <b data-hero="gain">&mdash;</b></span>
              <span>Held <b data-hero="units">&mdash;</b></span>
            </span>
          </div>
          <nav class="hs-qa" aria-label="Quick actions">
            <a href="/invest?buy=1" class="is-primary"><i>${icon('bitcoin', 20)}</i><span>Buy Bitcoin</span></a>
            <a href="/invest?sell=1"><i>${icon('chart', 20)}</i><span>Sell</span></a>
            <a href="/transfers"><i>${icon('withdraw', 20)}</i><span>Withdraw</span></a>
            <a href="/transactions"><i>${icon('activity', 20)}</i><span>History</span></a>
          </nav>
        </section>

        <div class="rf-grid cols-4 rf-mb">
          <div class="rf-card rf-stat"><div class="k">First bought</div><div class="v" data-stat="since">&mdash;</div><div class="d" data-stat="sinceSub">&nbsp;</div></div>
          <div class="rf-card rf-stat"><div class="k">Next maturity</div><div class="v" data-stat="maturity">&mdash;</div><div class="d" data-stat="maturitySub">&nbsp;</div></div>
          <div class="rf-card rf-stat"><div class="k">Bitcoin price now</div><div class="v" data-stat="price">&mdash;</div><div class="d" data-stat="priceSub">&nbsp;</div></div>
          <div class="rf-card rf-stat"><div class="k">Cash to invest</div><div class="v" data-stat="cash">&mdash;</div><div class="d" data-stat="cashSub">in your cash balance</div></div>
        </div>

        <section class="rf-card rf-mb hs-growth">
          <div class="rf-card-head">
            <h3>Growth since you invested</h3>
            <div class="rf-card-actions hs-growth-legend" aria-hidden="true">
              <span><i class="k value"></i>Value</span>
              <span><i class="k cost"></i>Amount invested</span>
              <span><i class="k buy"></i>Purchase</span>
            </div>
          </div>
          <div class="rf-card-body">
            <div class="hs-chart" data-growth-chart role="img" aria-label="Your Bitcoin's value since your first purchase">
              <div class="rf-skel" style="height:100%"></div>
            </div>
            <p class="rf-small rf-muted hs-chart-note" data-chart-note></p>
            <details class="hs-chart-table">
              <summary>Show the figures as a table</summary>
              <div class="rf-table-wrap">
                <table class="rf-table">
                  <thead><tr><th>Date</th><th class="num">Bitcoin price</th><th class="num">Amount invested</th><th class="num">Value</th><th class="num">Growth</th></tr></thead>
                  <tbody data-chart-rows></tbody>
                </table>
              </div>
            </details>
          </div>
        </section>

        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head">
              <h3>Your purchases</h3>
              <div class="rf-card-actions"><a class="rf-btn ghost sm" href="/invest">Buy or sell</a></div>
            </div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Bought</th><th class="num opt">Invested</th><th class="num opt">Price paid</th><th class="num">Value now</th><th class="num">Growth</th></tr></thead>
                <tbody data-positions><tr><td colspan="5" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
            <div class="rf-card-foot rf-small rf-muted" data-converting hidden>Your earlier investments are being converted to Bitcoin and will appear here once they are. This needs a live price, so it can take a few minutes.</div>
          </section>

          <div class="rf-stack">
            <section class="rf-card">
              <div class="rf-card-head"><h3>${icon('hourglass', 18)} Time to maturity</h3></div>
              <ul class="rf-list hs-terms" data-terms><li class="rf-muted rf-small">Loading&hellip;</li></ul>
            </section>

            <section class="rf-card">
              <div class="rf-card-head">
                <h3>Recent activity</h3>
                <div class="rf-card-actions"><a class="rf-btn ghost sm" href="/transactions">See all</a></div>
              </div>
              <ul class="rf-list" data-recent-list><li class="rf-muted rf-small">Loading&hellip;</li></ul>
            </section>
          </div>
        </div>

        <p class="rf-small rf-muted rf-mt hs-inv-note">${RISK} A maturity date is the end of the term you chose; it does not lock your Bitcoin, and it does not promise a value on that day.</p>`;

/* =========================================================== transactions == */

const transactionsContent = `
        <section class="rf-card rf-mb">
          <div class="rf-card-body tight">
            <form class="rf-row four" data-filters style="align-items:end">
              <div class="rf-field" style="margin:0">
                <label for="f-q">Search</label>
                <input class="rf-input" id="f-q" name="q" placeholder="Description or reference" />
              </div>
              <div class="rf-field" style="margin:0">
                <label for="f-account">Account</label>
                <select class="rf-select" id="f-account" name="accountId"><option value="">All accounts</option></select>
              </div>
              <div class="rf-field" style="margin:0">
                <label for="f-category">Category</label>
                <select class="rf-select" id="f-category" name="category"><option value="">All categories</option>${CATEGORIES.slice(0, CATEGORIES.indexOf('Other') + 1).map((c) => option(c)).join('')}</select>
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

/* ============================================================ withdrawals == */

const transfersContent = `
        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head"><h3>Withdraw cash</h3></div>
            <div class="rf-card-body">
              <p class="rf-small rf-muted" style="margin-top:0">Money goes from your cash balance to a bank account in your own name. To withdraw what is in Bitcoin, <a href="/invest?sell=1">sell it to cash</a> first.</p>
              <div class="rf-segment rf-mb" data-type-picker></div>

              <form id="rf-transfer-form" novalidate>
                <div class="rf-field">
                  <label for="t-from">From</label>
                  <select class="rf-select" id="t-from" name="fromAccountId" required></select>
                  <div class="hint" data-available></div>
                </div>

                <div class="rf-field" data-to-beneficiary>
                  <label for="t-beneficiary">To</label>
                  <select class="rf-select" id="t-beneficiary" name="beneficiaryId"></select>
                  <div class="hint"><a href="/recipients">Add or manage withdrawal accounts</a></div>
                </div>

                <div class="rf-row">
                  <div class="rf-field">
                    <label for="t-amount">Amount</label>
                    <input class="rf-input money" id="t-amount" name="amount" inputmode="decimal" placeholder="0.00" required />
                  </div>
                  ${dateField({ id: 't-date', name: 'scheduledFor', label: 'Withdraw on', from: 0, to: 3, order: 'asc', hint: 'Leave blank to withdraw now.' })}
                </div>

                <div class="rf-row">
                  <div class="rf-field">
                    <label for="t-recurrence">Repeat</label>
                    <select class="rf-select" id="t-recurrence" name="recurrence">
                      <option value="none">One time</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div class="rf-field" data-pin-field hidden>
                    <label for="t-pin">Withdrawal PIN</label>
                    <input class="rf-input mono" id="t-pin" name="pin" inputmode="numeric" maxlength="6" autocomplete="off" />
                  </div>
                </div>

                <div class="rf-field">
                  <label for="t-memo">Note <span class="rf-muted">(optional)</span></label>
                  <input class="rf-input" id="t-memo" name="memo" maxlength="140" placeholder="For your own records" />
                </div>

                <div class="rf-notice" data-summary></div>
                <div class="rf-notice bad rf-hide" data-form-error></div>
                <button class="rf-btn block" type="submit" data-submit>Review and withdraw</button>
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
            <h3>Your withdrawals</h3>
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
              <thead><tr><th>Date</th><th>To</th><th class="opt">Type</th><th class="opt">Confirmation</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead>
              <tbody data-transfers><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
            </table>
          </div>
        </section>`;

/* ============================================================= recipients == */

const recipientsContent = `
        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head">
              <h3>Your withdrawal accounts</h3>
              <div class="rf-card-actions rf-small rf-muted" data-count></div>
            </div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Name on the account</th><th class="opt">Held at</th><th>Account</th><th class="opt">Type</th><th>Status</th><th></th></tr></thead>
                <tbody data-rows><tr><td colspan="6" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
          </section>

          <section class="rf-card">
            <div class="rf-card-head"><h3>Add a withdrawal account</h3></div>
            <div class="rf-card-body">
              <p class="rf-small rf-muted" style="margin-top:0">An account in your own name at your bank, for us to pay withdrawals into. New accounts are checked by our team before the first withdrawal reaches them.</p>
              <form id="rf-beneficiary-form" novalidate>
                <div class="rf-field">
                  <label for="b-type">Where it is</label>
                  <select class="rf-select" id="b-type" name="type">
                    <option value="domestic_ach">An account in the US</option>
                    <option value="international_wire">An account outside the US</option>
                  </select>
                </div>
                <div class="rf-field">
                  <label for="b-name">Name on the account</label>
                  <input class="rf-input" id="b-name" name="name" required />
                </div>
                <div class="rf-field">
                  <label for="b-nickname">Nickname <span class="rf-muted">(optional)</span></label>
                  <input class="rf-input" id="b-nickname" name="nickname" placeholder="My everyday account" />
                </div>
                <div class="rf-field">
                  <label for="b-bank">Held at</label>
                  <input class="rf-input" id="b-bank" name="bankName" />
                </div>
                <div class="rf-field">
                  <label for="b-account">Account number</label>
                  <input class="rf-input mono" id="b-account" name="accountNumber" required />
                </div>
                <div class="rf-field" data-routing-field>
                  <label for="b-routing">Routing number</label>
                  <input class="rf-input mono" id="b-routing" name="routingNumber" inputmode="numeric" maxlength="9" />
                  <div class="hint">The nine digits your bank gives for payments in. We check it before we save it.</div>
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
                      <option value="checking">Current or checking</option>
                      <option value="savings">Savings</option>
                    </select>
                  </div>
                  <div class="rf-field">
                    <label for="b-relationship">Whose account</label>
                    <select class="rf-select" id="b-relationship" name="relationship">
                      <option value="Own account">Mine</option>
                      <option value="Joint account">Joint, in my name</option>
                    </select>
                  </div>
                </div>
                <div class="rf-notice bad rf-hide" data-form-error></div>
                <button class="rf-btn block" type="submit" data-submit>Save withdrawal account</button>
              </form>
            </div>
          </section>
        </div>`;

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
                  <label for="a-threshold">Alert me about movements over</label>
                  <input class="rf-input" id="a-threshold" name="alertThreshold" inputmode="decimal" />
                </div>
                <div class="rf-field">
                  <label for="a-low">Cash balance below</label>
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
              <p class="rf-muted rf-small">Choose a conversation, or start a new one. Messages here stay inside your signed-in session, so it is safe to include account details.</p>
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
                      <label for="s-pin">Withdrawal PIN</label>
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
                <p>Call us<span data-site-row="fraudPhone" hidden> on <strong data-site="fraudPhone"></strong></span>, day or night. We will never call you and ask for your password or a one-time code. If you think someone else has signed in, sign every device out from the list above.</p>
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
                <p class="rf-small rf-muted rf-mt">JPEG or PNG, up to 6MB. It appears here and to our team when we help you.</p>
              </div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Your account</h3></div>
              <div class="rf-card-body"><dl class="rf-dl" data-relationship></dl></div>
            </section>

          </div>
        </div>`;

/*
 * The Bitcoin screen: buy with cash, sell back to cash, and every purchase
 * with its term. public/js/bank/invest.js fills it from /invest.
 */
const investContent = `
        <div class="rf-grid cols-4 rf-mb" data-inv-totals>
          <div class="rf-card rf-stat hs-inv-hero"><div class="k">Your Bitcoin is worth</div><div class="v" data-inv="value">&mdash;</div><div class="d" data-inv="gain">&nbsp;</div></div>
          <div class="rf-card rf-stat"><div class="k">Invested</div><div class="v" data-inv="cost">&mdash;</div><div class="d">what your Bitcoin cost</div></div>
          <div class="rf-card rf-stat"><div class="k">Cash to invest</div><div class="v" data-inv="cash">&mdash;</div><div class="d">available in your cash balance</div></div>
          <div class="rf-card rf-stat"><div class="k">Bitcoin held</div><div class="v" data-inv="count">&mdash;</div><div class="d" data-inv="asof">&nbsp;</div></div>
        </div>

        <section class="rf-card rf-mb">
          <div class="rf-card-head">
            <h3>Buy Bitcoin</h3>
            <div class="rf-card-actions rf-small rf-muted" data-inv-source>Live price</div>
          </div>
          <p class="rf-small rf-muted hs-inv-lede">Bitcoin is the one asset we invest in. Choose an amount and how long you plan to hold it; you buy a fraction of a Bitcoin at the live price, booked the moment you confirm, and you can sell back to cash at any time.</p>
          <div class="hs-assets" data-inv-assets>
            <div class="rf-skel" style="height:118px"></div>
          </div>
        </section>

        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head"><h3>Your purchases</h3></div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Bought</th><th class="num">Bitcoin</th><th class="num opt">Price paid</th><th class="num">Value now</th><th class="num">Growth</th><th>Matures</th></tr></thead>
                <tbody data-inv-positions><tr><td colspan="6" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
            <div class="rf-card-foot rf-small rf-muted" data-inv-converting hidden>Your earlier investments are being converted to Bitcoin and will appear here once they are. This needs a live price, so it can take a few minutes.</div>
          </section>
          <section class="rf-card">
            <div class="rf-card-head"><h3>Recent purchases and sales</h3></div>
            <ul class="hs-trades" data-inv-trades><li class="rf-muted rf-small">Loading&hellip;</li></ul>
          </section>
        </div>

        <p class="rf-small rf-muted rf-mt hs-inv-note">The price comes from public market data. Each purchase or sale is booked at the price shown when you confirm; if the price has moved more than 2% since you opened the sheet, we show you the new price and ask again. ${RISK}</p>
`;

module.exports = [
  {
    file: 'signin.html',
    build: authPage,
    opts: { title: `Sign in | ${BANK.name}`, description: `Sign in to your ${BANK.name} Bitcoin investment.`, content: signinContent, extraScripts: ['/js/bank/signin.js'] },
  },
  {
    file: 'forgot.html',
    build: authPage,
    opts: { title: `Reset your password | ${BANK.name}`, description: `Reset your ${BANK.name} password.`, content: forgotContent, extraScripts: ['/js/bank/signin.js'] },
  },
  {
    file: 'change-password.html',
    build: authPage,
    opts: { title: `Choose a new password | ${BANK.name}`, description: 'Set a new password for your account.', content: changePasswordContent, extraScripts: ['/js/bank/signin.js'] },
  },
  {
    file: 'dashboard.html',
    build: appPage,
    opts: {
      title: `Dashboard | ${BANK.name}`, description: 'Your Bitcoin investment at a glance.',
      heading: 'Good to see you', sub: 'Your Bitcoin, from the day you bought it.',
      active: 'dashboard', content: dashboardContent, extraScripts: ['/js/bank/app.js'],
      actions: '<a class="rf-btn sm" href="/invest?buy=1">Buy Bitcoin</a>',
    },
  },
  {
    file: 'transactions.html',
    build: appPage,
    opts: {
      title: `Transactions | ${BANK.name}`, description: 'Every deposit, purchase, sale and withdrawal.',
      heading: 'Transactions', sub: 'Every deposit, purchase, sale and withdrawal.',
      active: 'transactions', content: transactionsContent, extraScripts: ['/js/bank/app.js'],
    },
  },
  {
    file: 'transfers.html',
    build: appPage,
    opts: {
      title: `Withdraw | ${BANK.name}`, description: 'Withdraw cash to a bank account in your name.',
      heading: 'Withdraw', sub: 'From your cash balance to a bank account in your name.',
      active: 'transfers', content: transfersContent, extraScripts: ['/js/bank/money.js'],
    },
  },
  {
    file: 'recipients.html',
    build: appPage,
    opts: {
      title: `Withdrawal accounts | ${BANK.name}`, description: 'The bank accounts your withdrawals are paid into.',
      heading: 'Withdrawal accounts', sub: 'The accounts in your name that withdrawals are paid into.',
      active: 'recipients', content: recipientsContent, extraScripts: ['/js/bank/money.js'],
    },
  },
  {
    file: 'invest.html',
    build: appPage,
    opts: {
      title: `Bitcoin | ${BANK.name}`, description: 'Buy and sell Bitcoin at the live price.',
      heading: 'Bitcoin', sub: 'Buy at the live price, choose your term, sell back to cash any time.',
      active: 'invest', content: investContent, extraScripts: ['/js/bank/invest.js'],
      actions: '<button class="rf-btn sm" type="button" data-inv-quick>Buy Bitcoin</button>',
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
      title: `Messages | ${BANK.name}`, description: 'Secure messages with our team.',
      heading: 'Secure messages', sub: 'Inside your session, so account details are safe to send.',
      active: 'messages', content: messagesContent, extraScripts: ['/js/bank/app.js'],
    },
  },
  {
    file: 'security.html',
    build: appPage,
    opts: {
      title: `Security | ${BANK.name}`, description: 'Password, verification and signed-in devices.',
      heading: 'Security', sub: 'Password, two-step verification, withdrawal PIN and devices.',
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

/**
 * Pages retired with the banking features, and where each now goes. Read by
 * src/app.js, and written into vercel.json's redirects (checked by
 * test/api.test.js), so an old bookmark lands somewhere useful.
 */
module.exports.RETIRED = {
  '/accounts': '/dashboard',
  '/statements': '/transactions',
  '/bills': '/transfers',
  '/deposit': '/dashboard',
  '/cards': '/dashboard',
};
