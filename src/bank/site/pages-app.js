'use strict';

/**
 * The signed-in application and the sign-in pages.
 *
 * Each page is a skeleton: the structure, the empty states and the forms are
 * in the HTML, and the numbers arrive from /api/bank once the page is up. The
 * containers carry data- attributes rather than ids where more than one of a
 * thing can exist, which is what the scripts look for.
 */

const { appPage, authPage, icon, RISK } = require('./layout');
const { BANK, US_STATES, SECURITY_QUESTIONS, DOCUMENT_KINDS, VAULT } = require('../constants');

const option = (value, label) => `<option value="${value}">${label || value}</option>`;
const stateOptions = US_STATES.map((s) => option(s)).join('');

/** The Bitcoin mark, drawn as public/js/assets.js draws it, for pages before their script runs. */
const btcMark = (px = 20) => `<span class="hs-logo" aria-hidden="true" style="--s:${px}px;background:linear-gradient(135deg,#f7931a,#ffb347);color:#fff;font-size:${Math.round(px * 0.5)}px">&#8383;</span>`;

/** A term in whole years, with quick choices; the maturity it gives is previewed by the page script. */
const termField = (id, name = 'termYears') => `
                <div class="rf-field">
                  <label for="${id}">Keep it in the vault for</label>
                  <div class="hs-term-input"><input class="rf-input" type="number" id="${id}" name="${name}" min="${VAULT.termYears.min}" max="${VAULT.termYears.max}" step="1" required /><span>years</span></div>
                  <div class="hs-chips" role="group" aria-label="Quick terms">${[10, 20, 30, 50, 100].map((y) => `<button type="button" data-term="${y}">${y} years</button>`).join('')}</div>
                  <div class="hint" data-term-preview>${VAULT.termYears.min} to ${VAULT.termYears.max} years. It can be sent out once it matures.</div>
                </div>`;

/* ================================================================ sign in == */

const signinContent = `
      <div class="rf-auth-box">
        <h1>Sign in to your vault</h1>
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
                <input class="rf-input" type="password" id="rf-password" data-show-password name="password" autocomplete="current-password" required />
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
          <a href="/open-account">Open your vault</a>
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
        <p class="lede">We will email a code to the address you signed up with.</p>
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
                <input class="rf-input" type="password" id="rf-new-password" data-show-password name="newPassword" autocomplete="new-password" required />
                <div class="hint">At least 10 characters, with upper and lower case, a number and a symbol.</div>
              </div>
              <div class="rf-field">
                <label for="rf-confirm-password">Confirm new password</label>
                <input class="rf-input" type="password" id="rf-confirm-password" data-show-password name="confirm" autocomplete="new-password" required />
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
                <input class="rf-input" type="password" id="rf-current" data-show-password name="currentPassword" autocomplete="current-password" required />
              </div>
              <div class="rf-field">
                <label for="rf-next">New password</label>
                <input class="rf-input" type="password" id="rf-next" data-show-password name="newPassword" autocomplete="new-password" required />
                <div class="hint">At least 10 characters, with upper and lower case, a number and a symbol.</div>
              </div>
              <div class="rf-field">
                <label for="rf-next-confirm">Confirm new password</label>
                <input class="rf-input" type="password" id="rf-next-confirm" data-show-password name="confirm" autocomplete="new-password" required />
              </div>
              <div class="rf-notice bad rf-hide" data-form-error></div>
              <button class="rf-btn block" type="submit" data-submit>Save and continue</button>
            </form>
          </div>
        </div>
      </div>`;

/* ============================================================== dashboard == */

/*
 * The dashboard is the vault: what the Bitcoin in it is worth, what went in,
 * how it has grown since the first day, and for each investment the day it
 * went in and the day it matures. public/js/bank/app.js fills every [data-*]
 * below from /invest, /overview and /markets/history.
 */
const dashboardContent = `
        <section class="hs-vault rf-mb">
          <div class="hs-vault-head hs-dash-hero hs-btc-hero">
            <div class="hs-hero-top">
              <div class="hs-dash-hero-main">
                <span class="k">${btcMark(22)} Your vault is worth</span>
                <strong class="v" data-hero="value">&mdash;</strong>
                <div class="hs-hero-pills">
                  <span class="hs-pill hs-pill-gain" data-hero="gainPill"><span class="arrow" aria-hidden="true">&#9650;</span><b data-hero="gain">&mdash;</b><small>all time</small></span>
                  <span class="hs-pill">${btcMark(14)}<b data-hero="units">&mdash;</b></span>
                  <span class="hs-pill hs-pill-status" data-hero="status" hidden></span>
                </div>
              </div>
              <nav class="hs-qa" aria-label="Quick actions">
                <a href="/receive" class="is-primary"><i>${icon('receive', 20)}</i><span>Receive</span></a>
                <a href="/send"><i>${icon('send', 20)}</i><span>Send</span></a>
                <a href="/vault"><i>${icon('vault', 20)}</i><span>My vault</span></a>
                <a href="/history"><i>${icon('activity', 20)}</i><span>History</span></a>
              </nav>
            </div>
            <div class="hs-hero-facts">
              <div class="hs-fact"><span class="k">${icon('deposit', 13)} Invested</span><b data-hero="cost">&mdash;</b><small data-hero="costSub">&nbsp;</small></div>
              <div class="hs-fact"><span class="k">${icon('clock', 13)} First invested</span><b data-stat="since">&mdash;</b><small data-stat="sinceSub">&nbsp;</small></div>
              <div class="hs-fact is-maturity"><span class="k">${icon('hourglass', 13)} Next maturity</span><b data-stat="maturity">&mdash;</b><small data-stat="maturitySub">&nbsp;</small><span class="hs-fact-bar" aria-hidden="true"><i data-hero="termBar"></i></span></div>
              <div class="hs-fact"><span class="k">${icon('user', 13)} Member since</span><b data-hero="joined">&mdash;</b><small data-hero="joinedSub">&nbsp;</small></div>
            </div>
          </div>
          <div class="hs-vault-chart hs-growth">
            <div class="hs-vault-chart-head">
              <h3>Growth since you first invested</h3>
              <div class="hs-growth-legend" aria-hidden="true">
                <span><i class="k value"></i>Value</span>
                <span><i class="k cost"></i>Amount invested</span>
                <span><i class="k buy"></i>Added to the vault</span>
              </div>
            </div>
            <div class="hs-chart" data-growth-chart role="img" aria-label="The value of your vault since you first invested">
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

        <div class="rf-grid cols-4 rf-mb hs-dates">
          <div class="rf-card rf-stat"><div class="k">${btcMark(16)} Bitcoin price now</div><div class="v" data-stat="price">&mdash;</div><div class="d" data-stat="priceSub">&nbsp;</div></div>
          <div class="rf-card rf-stat"><div class="k">${icon('activity', 15)} Average price paid</div><div class="v" data-stat="avg">&mdash;</div><div class="d" data-stat="avgSub">&nbsp;</div></div>
          <div class="rf-card rf-stat hs-date is-in"><div class="k">${icon('vault', 15)} Investments</div><div class="v" data-stat="count">&mdash;</div><div class="d" data-stat="countSub">&nbsp;</div></div>
          <div class="rf-card rf-stat hs-date is-out"><div class="k">${icon('send', 15)} Ready to send</div><div class="v" data-stat="ready">&mdash;</div><div class="d" data-stat="readySub">Bitcoin that has matured</div></div>
        </div>

        <section class="rf-card rf-mb">
          <div class="rf-card-head">
            <h3>Each investment, from the day it went in to the day it matures</h3>
            <div class="rf-card-actions"><a class="rf-btn ghost sm" href="/receive">Add to your vault</a></div>
          </div>
          <ol class="hs-timeline" data-timeline><li class="rf-muted rf-small">Loading&hellip;</li></ol>
          <div class="rf-card-foot rf-small rf-muted" data-converting hidden>Your earlier holdings are being converted to Bitcoin and will appear here once they are. This needs a live price, so it can take a few minutes.</div>
        </section>

        <div class="rf-grid cols-2">
          <section class="rf-card">
            <div class="rf-card-head">
              <h3>Your requests</h3>
              <div class="rf-card-actions"><a class="rf-btn ghost sm" href="/receive">Receive</a> <a class="rf-btn ghost sm" href="/send">Send</a></div>
            </div>
            <ul class="rf-list" data-requests><li class="rf-muted rf-small">Loading&hellip;</li></ul>
          </section>
          <section class="rf-card">
            <div class="rf-card-head">
              <h3>Recent movements</h3>
              <div class="rf-card-actions"><a class="rf-btn ghost sm" href="/history">See all</a></div>
            </div>
            <ul class="rf-list" data-recent-list><li class="rf-muted rf-small">Loading&hellip;</li></ul>
          </section>
        </div>

        <p class="rf-small rf-muted rf-mt hs-inv-note">${RISK} Bitcoin can be sent out of your vault once it reaches its maturity date. A maturity date is not a promise of any value on that day.</p>`;

/* ================================================================ history == */

const historyContent = `
        <section class="rf-card rf-mb">
          <div class="rf-card-body tight">
            <form class="rf-filter" data-filters>
              <div class="rf-field">
                <label for="h-kind">Show</label>
                <select class="rf-select" id="h-kind" name="kind">
                  <option value="">Everything</option>
                  <option value="in">Into the vault</option>
                  <option value="out">Out of the vault</option>
                  <option value="cash">Paid in cash</option>
                  <option value="bitcoin">Bitcoin received</option>
                  <option value="sent">Bitcoin sent</option>
                  <option value="converted">Conversions</option>
                </select>
              </div>
              <div class="rf-field"><label for="h-from">From</label><input class="rf-input" type="date" id="h-from" name="from" min="${VAULT.earliest}" /></div>
              <div class="rf-field"><label for="h-to">To</label><input class="rf-input" type="date" id="h-to" name="to" min="${VAULT.earliest}" /></div>
              <div class="rf-field" style="align-self:end"><button class="rf-btn sm" type="submit">Filter</button> <a class="rf-btn ghost sm" href="/api/bank/vault/history/export" download>Download CSV</a></div>
            </form>
          </div>
        </section>
        <section class="rf-card">
          <div class="rf-card-head"><h3>Everything that moved</h3><div class="rf-card-actions rf-small rf-muted" data-count></div></div>
          <div class="rf-table-wrap">
            <table class="rf-table">
              <thead><tr><th>Date</th><th>What</th><th class="num">Bitcoin</th><th class="num opt">Bitcoin price</th><th class="num">Value</th><th class="opt">Matures</th><th class="opt">Reference</th></tr></thead>
              <tbody data-rows><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
            </table>
          </div>
        </section>`;

/* ================================================================ receive == */

const receiveContent = `
        <div class="rf-grid cols-2 hs-receive">
          <section class="rf-card">
            <div class="rf-card-head"><h3>${icon('receive', 18)} Pay with cash</h3></div>
            <div class="rf-card-body">
              <p class="rf-small rf-muted" style="margin-top:0">Pay our OTC partner from a bank in your name. When they confirm your payment, it buys Bitcoin at that day&rsquo;s price and goes into your vault.</p>
              <div data-otc data-suspend-closed><div class="rf-skel" style="height:140px"></div></div>
              <form id="hs-cash-form" data-suspend-closed class="rf-mt" novalidate hidden>
                <h4 class="rf-label">Once you have paid, tell us</h4>
                <div class="rf-row">
                  <div class="rf-field"><label for="c-amount">Amount paid (USD)</label><input class="rf-input money" id="c-amount" name="amount" inputmode="decimal" placeholder="0.00" required /></div>
                  <div class="rf-field"><label for="c-date">Paid on</label><input class="rf-input" type="date" id="c-date" name="occurredAt" min="${VAULT.earliest}" required /></div>
                </div>
                ${termField('c-term')}
                <div class="rf-field"><label for="c-note">Anything we should know</label><input class="rf-input" id="c-note" name="note" maxlength="300" placeholder="Paid from my bank in two parts" /></div>
                <div class="rf-notice bad rf-hide" data-form-error></div>
                <button class="rf-btn block" type="submit" data-submit>I have paid</button>
              </form>
            </div>
          </section>

          <section class="rf-card">
            <div class="rf-card-head"><h3>${btcMark(18)} Send Bitcoin to your vault</h3></div>
            <div class="rf-card-body">
              <p class="rf-small rf-muted" style="margin-top:0">Send Bitcoin from a wallet of yours to the address below. When it has arrived it is added to your vault, valued at that day&rsquo;s price.</p>
              <div data-address data-suspend-closed><div class="rf-skel" style="height:96px"></div></div>
              <form id="hs-btc-form" data-suspend-closed class="rf-mt" novalidate hidden>
                <h4 class="rf-label">Once you have sent it, tell us</h4>
                <div class="rf-row">
                  <div class="rf-field"><label for="b-units">Bitcoin sent</label><input class="rf-input money" id="b-units" name="units" inputmode="decimal" placeholder="0.00000000" required /></div>
                  <div class="rf-field"><label for="b-date">Sent on</label><input class="rf-input" type="date" id="b-date" name="occurredAt" min="${VAULT.earliest}" required /></div>
                </div>
                <div class="rf-field"><label for="b-txid">Transaction ID <span class="rf-muted">(if you have it)</span></label><input class="rf-input mono" id="b-txid" name="txid" maxlength="64" autocomplete="off" /></div>
                ${termField('b-term')}
                <div class="rf-notice bad rf-hide" data-form-error></div>
                <button class="rf-btn block" type="submit" data-submit>I have sent it</button>
              </form>
            </div>
          </section>
        </div>

        <section class="rf-card rf-mt">
          <div class="rf-card-head"><h3>Your requests</h3></div>
          <div class="rf-table-wrap">
            <table class="rf-table">
              <thead><tr><th>Asked</th><th>What</th><th class="num">Amount</th><th class="opt">Term</th><th>Status</th><th class="opt">Reference</th><th></th></tr></thead>
              <tbody data-requests><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
            </table>
          </div>
        </section>`;

/* =================================================================== send == */

const sendContent = `
        <div class="rf-grid side">
          <section class="rf-card">
            <div class="rf-card-head"><h3>${icon('send', 18)} Send Bitcoin</h3></div>
            <div class="rf-card-body">
              <div class="hs-ready">
                <span class="k">${btcMark(20)} Ready to send</span>
                <strong class="v" data-ready>&mdash;</strong>
                <span class="d" data-ready-sub>Only Bitcoin that has reached its maturity date can be sent.</span>
              </div>
              <form id="hs-send-form" data-suspend-closed class="rf-mt" novalidate>
                <div class="rf-field">
                  <label for="s-units">How much</label>
                  <input class="rf-input money" id="s-units" name="units" inputmode="decimal" placeholder="0.00000000" required />
                  <div class="hs-chips" role="group" aria-label="Quick amounts"><button type="button" data-share="25">25%</button><button type="button" data-share="50">50%</button><button type="button" data-share="100">All of it</button></div>
                  <div class="hint" data-send-value>&nbsp;</div>
                </div>
                <div class="rf-field">
                  <label for="s-address">To this Bitcoin address</label>
                  <!-- Not a login: these keep browsers and password managers from filling in an email address. -->
                  <input class="rf-input mono hs-address-input" id="s-address" name="address" type="text"
                    autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                    data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"
                    placeholder="e.g. bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" required />
                  <div class="hs-addr-status" data-address-status hidden></div>
                  <div class="hs-addr-warn" role="note">
                    <strong>Check the address before you send.</strong>
                    Copy it from the Receive screen of your own wallet and paste it here; never type it, or take it from an email or a message. Compare the first and last six characters with your wallet. Bitcoin sent to a wrong address cannot be brought back.
                  </div>
                </div>
                <div class="rf-field" data-pin-field hidden>
                  <label for="s-pin">Your PIN</label>
                  <input class="rf-input mono" type="password" id="s-pin" name="pin" inputmode="numeric" maxlength="6" autocomplete="new-password" data-lpignore="true" data-1p-ignore data-bwignore />
                </div>
                <div class="rf-field"><label for="s-note">Note for us</label><input class="rf-input" id="s-note" name="note" maxlength="300" /></div>
                <div class="rf-notice bad rf-hide" data-form-error></div>
                <button class="rf-btn block" type="submit" data-submit>Continue</button>
                <p class="rf-small rf-muted hs-center">We email you a code to confirm. Our team then checks the request and sends it from the vault.</p>
              </form>
            </div>
          </section>

          <section class="rf-card">
            <div class="rf-card-head"><h3>${icon('hourglass', 18)} When the rest matures</h3></div>
            <ul class="rf-list hs-terms" data-upcoming><li class="rf-muted rf-small">Loading&hellip;</li></ul>
          </section>
        </div>

        <section class="rf-card rf-mt">
          <div class="rf-card-head"><h3>Your requests to send</h3></div>
          <div class="rf-table-wrap">
            <table class="rf-table">
              <thead><tr><th>Asked</th><th class="num">Bitcoin</th><th>To</th><th>Status</th><th class="opt">Reference</th><th></th></tr></thead>
              <tbody data-requests><tr><td colspan="6" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
            </table>
          </div>
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
                      <input class="rf-input" type="password" id="s-current" data-show-password name="currentPassword" autocomplete="current-password" required />
                    </div>
                    <div class="rf-field">
                      <label for="s-new">New password</label>
                      <input class="rf-input" type="password" id="s-new" data-show-password name="newPassword" autocomplete="new-password" required />
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
                      <label for="s-pin">PIN for sending Bitcoin</label>
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
          <div class="rf-card-head"><h3>Sign-ins and changes</h3><div class="rf-card-actions rf-small rf-muted">Everything done in your name, with the device and address it came from</div></div>
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
              <div class="rf-card-head"><h3>Your details with us</h3></div>
              <div class="rf-card-body"><dl class="rf-dl" data-relationship></dl></div>
            </section>

          </div>
        </div>`;

/*
 * My vault: what is in it, each investment with the day it went in and the
 * day it matures, and what has moved. public/js/bank/vault.js fills it from
 * /invest.
 */
const vaultContent = `
        <div class="rf-grid cols-4 rf-mb" data-inv-totals>
          <div class="rf-card rf-stat hs-inv-hero"><div class="k">${btcMark(16)} Your vault is worth</div><div class="v" data-inv="value">&mdash;</div><div class="d" data-inv="gain">&nbsp;</div></div>
          <div class="rf-card rf-stat"><div class="k">Invested</div><div class="v" data-inv="cost">&mdash;</div><div class="d">what went into it</div></div>
          <div class="rf-card rf-stat"><div class="k">Bitcoin held</div><div class="v" data-inv="count">&mdash;</div><div class="d" data-inv="asof">&nbsp;</div></div>
          <div class="rf-card rf-stat"><div class="k">Ready to send</div><div class="v" data-inv="ready">&mdash;</div><div class="d" data-inv="readySub">matured</div></div>
        </div>

        <section class="rf-card rf-mb">
          <div class="rf-card-head">
            <h3>What is in your vault</h3>
            <div class="rf-card-actions"><a class="rf-btn sm" href="/receive">Add to it</a> <a class="rf-btn ghost sm" href="/send">Send</a></div>
          </div>
          <div class="rf-table-wrap">
            <table class="rf-table">
              <thead><tr><th>Invested</th><th class="num">Bitcoin</th><th class="num opt">Price then</th><th class="num">Value now</th><th class="num">Growth</th><th>Matures</th></tr></thead>
              <tbody data-inv-positions><tr><td colspan="6" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
            </table>
          </div>
          <div class="rf-card-foot rf-small rf-muted" data-inv-converting hidden>Your earlier holdings are being converted to Bitcoin and will appear here once they are. This needs a live price, so it can take a few minutes.</div>
        </section>

        <section class="rf-card">
          <div class="rf-card-head"><h3>Recent movements</h3><div class="rf-card-actions"><a class="rf-btn ghost sm" href="/history">Full history</a></div></div>
          <ul class="hs-trades" data-inv-trades><li class="rf-muted rf-small">Loading&hellip;</li></ul>
        </section>

        <p class="rf-small rf-muted rf-mt hs-inv-note"><span data-inv-source>Live price</span>. Everything added to your vault is priced at Bitcoin&rsquo;s closing price on the day it was paid or arrived. ${RISK}</p>
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
      title: `Dashboard | ${BANK.name}`, description: 'Your Bitcoin vault at a glance.',
      heading: 'Good to see you', sub: 'Your vault, from the day you first invested.',
      active: 'dashboard', content: dashboardContent, extraScripts: ['/js/bank/app.js'],
      actions: '<a class="rf-btn sm" href="/receive">Add to your vault</a>',
    },
  },
  {
    file: 'vault.html',
    build: appPage,
    opts: {
      title: `My vault | ${BANK.name}`, description: 'What is in your vault, and when each part matures.',
      heading: 'My vault', sub: 'Each investment, what it is worth now, and when it matures.',
      active: 'vault', content: vaultContent, extraScripts: ['/js/bank/vault.js'],
    },
  },
  {
    file: 'history.html',
    build: appPage,
    opts: {
      title: `History | ${BANK.name}`, description: 'Everything that has moved into or out of your vault.',
      heading: 'History', sub: 'Everything that has moved into or out of your vault.',
      active: 'history', content: historyContent, extraScripts: ['/js/bank/vault.js'],
    },
  },
  {
    file: 'receive.html',
    build: appPage,
    opts: {
      title: `Receive | ${BANK.name}`, description: 'Add to your vault with cash or Bitcoin.',
      heading: 'Receive', sub: 'Add to your vault: pay cash through our OTC partner, or send Bitcoin.',
      active: 'receive', content: receiveContent, extraScripts: ['/js/bank/vault.js'],
    },
  },
  {
    file: 'send.html',
    build: appPage,
    opts: {
      title: `Send | ${BANK.name}`, description: 'Send matured Bitcoin to a wallet of yours.',
      heading: 'Send', sub: 'Send Bitcoin that has matured to a wallet of yours.',
      active: 'send', content: sendContent, extraScripts: ['/js/btc-address.js', '/js/bank/vault.js'],
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
      heading: 'Secure messages', sub: 'Inside your session, so personal details are safe to send.',
      active: 'messages', content: messagesContent, extraScripts: ['/js/bank/app.js'],
    },
  },
  {
    file: 'security.html',
    build: appPage,
    opts: {
      title: `Security | ${BANK.name}`, description: 'Password, verification and signed-in devices.',
      heading: 'Security', sub: 'Password, two-step verification, your PIN and devices.',
      active: 'security', content: securityContent, extraScripts: ['/js/bank/profile.js'],
    },
  },
  {
    file: 'activity.html',
    build: appPage,
    opts: {
      title: `Activity | ${BANK.name}`, description: 'Every sign-in and change made in your name.',
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
  '/statements': '/history',
  '/bills': '/send',
  '/deposit': '/receive',
  '/cards': '/dashboard',
  '/invest': '/vault',
  '/transactions': '/history',
  '/transfers': '/send',
  '/recipients': '/send',
};
