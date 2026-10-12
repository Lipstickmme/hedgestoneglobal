'use strict';

/**
 * The staff console: one page, a tab per job.
 *
 * Kept on a single page on purpose. The work here is interleaved - a held
 * transfer sends you to the customer, the customer sends you to their
 * documents, the documents send you back to the transfer - and a page load
 * between each step is what makes a console tiring to use.
 */

const { appPage, icon, dateField } = require('./layout');
const { BANK, PRODUCTS, US_STATES, CATEGORIES, TRANSACTION_METHODS, REJECTION_REASONS, DOCUMENT_KINDS } = require('../constants');

const option = (value, label) => `<option value="${value}">${label || value}</option>`;

const content = `
        <div class="rf-tabs" data-tabs>
          <button data-tab="overview" class="is-active">Overview</button>
          <button data-tab="customers">Customers</button>
          <button data-tab="register">Register a customer</button>
          <button data-tab="queue">Transfer queue <em class="rf-pip rf-hide" data-queue-pip></em></button>
          <button data-tab="deposits">Check deposits</button>
          <button data-tab="cards">Cards</button>
          <button data-tab="messages">Messages</button>
          <button data-tab="alerts">Email alerts</button>
          <button data-tab="disputes">Claims</button>
          <button data-tab="activity">Activity log</button>
          <button data-tab="settings">Settings</button>
        </div>

        <!-- ---------------------------------------------------- overview -- -->
        <section data-panel="overview">
          <div class="rf-grid cols-4 rf-mb" data-stats></div>
          <div class="rf-grid side">
            <section class="rf-card">
              <div class="rf-card-head"><h3>Waiting for a decision</h3><div class="rf-card-actions"><button class="rf-btn ghost sm" data-goto="queue">Open the queue</button></div></div>
              <div class="rf-table-wrap">
                <table class="rf-table">
                  <thead><tr><th>Customer</th><th>Type</th><th>Recipient</th><th class="num">Amount</th><th>Submitted</th></tr></thead>
                  <tbody data-queue-preview><tr><td colspan="5" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
                </table>
              </div>
            </section>
            <div class="rf-stack">
              <section class="rf-card">
                <div class="rf-card-head"><h3>Latest activity</h3></div>
                <ul class="rf-list" data-activity-preview><li class="rf-muted rf-small">Loading&hellip;</li></ul>
              </section>
              <section class="rf-card">
                <div class="rf-card-head"><h3>Newest customers</h3></div>
                <ul class="rf-list" data-new-customers><li class="rf-muted rf-small">Loading&hellip;</li></ul>
              </section>
            </div>
          </div>
        </section>

        <!-- --------------------------------------------------- customers -- -->
        <section data-panel="customers" hidden>
          <section class="rf-card rf-mb">
            <div class="rf-card-body tight">
              <form class="rf-inline" data-customer-filters>
                <input class="rf-input" name="q" placeholder="Name, email, customer number, last 4 of SSN" style="max-width:340px" />
                <select class="rf-select" name="status" style="width:auto"><option value="">Any status</option>${['active', 'suspended', 'pending', 'closed'].map((s) => option(s)).join('')}</select>
                <select class="rf-select" name="kyc" style="width:auto"><option value="">Any KYC</option>${['pending', 'review', 'verified', 'rejected'].map((s) => option(s)).join('')}</select>
                <select class="rf-select" name="role" style="width:auto"><option value="">Customers and staff</option><option value="customer">Customers</option><option value="admin">Staff</option></select>
                <button class="rf-btn sm" type="submit">Search</button>
              </form>
            </div>
          </section>
          <section class="rf-card">
            <div class="rf-card-head"><h3>Customers</h3><div class="rf-card-actions rf-small rf-muted" data-customer-count></div></div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Customer</th><th>Customer no.</th><th>Status</th><th>KYC</th><th class="num">Accounts</th><th class="num">Relationship</th><th>Joined</th></tr></thead>
                <tbody data-customers><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
          </section>
        </section>

        <!-- ---------------------------------------------------- register -- -->
        <section data-panel="register" hidden>
          <form id="rf-register-form" novalidate>
            <div class="rf-grid side">
              <div class="rf-stack">
                <section class="rf-card">
                  <div class="rf-card-head"><h3>Who they are</h3></div>
                  <div class="rf-card-body">
                    <div class="rf-row three">
                      <div class="rf-field"><label for="r-first">First name</label><input class="rf-input" id="r-first" name="firstName" required /></div>
                      <div class="rf-field"><label for="r-middle">Middle</label><input class="rf-input" id="r-middle" name="middleName" /></div>
                      <div class="rf-field"><label for="r-last">Last name</label><input class="rf-input" id="r-last" name="lastName" required /></div>
                    </div>
                    <div class="rf-row">
                      ${dateField({ id: 'r-dob', name: 'dateOfBirth', label: 'Date of birth', from: -110, to: -18 })}
                      <div class="rf-field"><label for="r-ssn">Social Security number</label><input class="rf-input mono" id="r-ssn" name="ssn" placeholder="000-00-0000" maxlength="11" /></div>
                    </div>
                    <div class="rf-row">
                      <div class="rf-field"><label for="r-email">Email (their username)</label><input class="rf-input" type="email" id="r-email" name="email" required /></div>
                      <div class="rf-field"><label for="r-phone">Phone</label><input class="rf-input" id="r-phone" name="phone" /></div>
                    </div>
                    <div class="rf-row">
                      <div class="rf-field"><label for="r-citizenship">Citizenship</label><input class="rf-input" id="r-citizenship" name="citizenship" value="US" /></div>
                      <div class="rf-field"><label for="r-tax">Tax ID type</label><select class="rf-select" id="r-tax" name="taxIdType">${['SSN', 'ITIN', 'EIN'].map((t) => option(t)).join('')}</select></div>
                    </div>
                  </div>
                </section>

                <section class="rf-card">
                  <div class="rf-card-head"><h3>Where they live</h3></div>
                  <div class="rf-card-body">
                    <div class="rf-field"><label for="r-addr1">Street address</label><input class="rf-input" id="r-addr1" name="addressLine1" /></div>
                    <div class="rf-field"><label for="r-addr2">Apartment, suite</label><input class="rf-input" id="r-addr2" name="addressLine2" /></div>
                    <div class="rf-row three">
                      <div class="rf-field"><label for="r-city">City</label><input class="rf-input" id="r-city" name="city" /></div>
                      <div class="rf-field"><label for="r-state">State</label><select class="rf-select" id="r-state" name="state">${US_STATES.map((s) => option(s)).join('')}</select></div>
                      <div class="rf-field"><label for="r-zip">ZIP</label><input class="rf-input mono" id="r-zip" name="postalCode" maxlength="10" /></div>
                    </div>
                  </div>
                </section>

                <section class="rf-card">
                  <div class="rf-card-head"><h3>Identity and income</h3></div>
                  <div class="rf-card-body">
                    <div class="rf-row">
                      <div class="rf-field"><label for="r-id-type">ID document</label><select class="rf-select" id="r-id-type" name="idType">${['Driver’s license', 'State ID', 'Passport', 'Military ID'].map((t) => option(t)).join('')}</select></div>
                      <div class="rf-field"><label for="r-id-number">ID number</label><input class="rf-input mono" id="r-id-number" name="idNumber" /></div>
                    </div>
                    <div class="rf-row">
                      <div class="rf-field"><label for="r-id-state">Issuing state</label><select class="rf-select" id="r-id-state" name="idState">${US_STATES.map((s) => option(s)).join('')}</select></div>
                      ${dateField({ id: 'r-id-expires', name: 'idExpires', label: 'Expires', from: -5, to: 20, order: 'asc' })}
                    </div>
                    <div class="rf-row">
                      <div class="rf-field"><label for="r-employment">Employment</label><select class="rf-select" id="r-employment" name="employmentStatus">${['Employed', 'Self-employed', 'Retired', 'Student', 'Not employed'].map((e) => option(e)).join('')}</select></div>
                      <div class="rf-field"><label for="r-employer">Employer</label><input class="rf-input" id="r-employer" name="employer" /></div>
                    </div>
                    <div class="rf-row">
                      <div class="rf-field"><label for="r-occupation">Occupation</label><input class="rf-input" id="r-occupation" name="occupation" /></div>
                      <div class="rf-field"><label for="r-income">Annual income</label><input class="rf-input" id="r-income" name="annualIncome" inputmode="decimal" placeholder="0.00" /></div>
                    </div>
                    <div class="rf-field"><label for="r-funds">Source of funds</label><input class="rf-input" id="r-funds" name="sourceOfFunds" placeholder="Salary, business income, inheritance" /></div>
                    <div class="rf-row four">
                      ${['avatar', 'id_front', 'id_back', 'proof_address'].map((kind) => `
                      <div class="rf-field">
                        <label>${(DOCUMENT_KINDS.find((k) => k.id === kind) || {}).label || kind}</label>
                        <label class="rf-card" style="display:block;padding:14px;text-align:center;cursor:pointer;border-style:dashed">
                          <input type="file" accept="image/*,application/pdf" data-doc="${kind}" hidden />
                          <span class="rf-small rf-muted" data-doc-preview="${kind}">Choose file</span>
                        </label>
                      </div>`).join('')}
                    </div>
                  </div>
                </section>
              </div>

              <div class="rf-stack">
                <section class="rf-card">
                  <div class="rf-card-head"><h3>Accounts to open</h3></div>
                  <div class="rf-card-body">
                    <div data-account-rows></div>
                    <button class="rf-btn ghost sm" type="button" data-add-account>${icon('plus', 14)} Add another account</button>
                  </div>
                </section>

                <section class="rf-card">
                  <div class="rf-card-head"><h3>Access</h3></div>
                  <div class="rf-card-body">
                    <div class="rf-field">
                      <label for="r-password">Temporary password</label>
                      <input class="rf-input mono" id="r-password" name="password" placeholder="Leave blank and we will generate one" />
                    </div>
                    <label class="rf-check"><input type="checkbox" name="mustChangePassword" checked /><span>Make them choose a new password at first sign-in</span></label>
                    <label class="rf-check"><input type="checkbox" name="twoFactorEnabled" checked /><span>Two-step verification on every sign-in</span></label>
                    <div class="rf-row">
                      <div class="rf-field"><label for="r-tier">Tier</label><select class="rf-select" id="r-tier" name="tier">${['Standard', 'Premier', 'Private'].map((t) => option(t)).join('')}</select></div>
                      <div class="rf-field"><label for="r-kyc">KYC status</label><select class="rf-select" id="r-kyc" name="kycStatus">${['pending', 'review', 'verified'].map((t) => option(t)).join('')}</select></div>
                    </div>
                    <div class="rf-field"><label for="r-notes">Internal notes</label><textarea class="rf-textarea" id="r-notes" name="notes" style="min-height:70px"></textarea></div>
                    <div class="rf-notice bad rf-hide" data-form-error></div>
                    <button class="rf-btn block" type="submit" data-submit>Register customer</button>
                    <p class="rf-small rf-muted rf-mt">A welcome email goes out with the customer number, the accounts opened and the temporary password.</p>
                  </div>
                </section>
              </div>
            </div>
          </form>
        </section>

        <!-- ------------------------------------------------------- queue -- -->
        <section data-panel="queue" hidden>
          <section class="rf-card">
            <div class="rf-card-head">
              <h3>Transfers</h3>
              <div class="rf-card-actions">
                <select class="rf-select" data-queue-status style="width:auto">
                  <option value="pending_review">In review</option>
                  <option value="">Everything</option>
                  <option value="pending_verification">Awaiting the customer&rsquo;s code</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Returned</option>
                </select>
                <button class="rf-btn ghost sm" data-run-scheduled>Run scheduled now</button>
              </div>
            </div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Submitted</th><th>Customer</th><th>Type</th><th>Recipient</th><th>Confirmation</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead>
                <tbody data-queue><tr><td colspan="8" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
          </section>
        </section>

        <!-- ---------------------------------------------------- deposits -- -->
        <section data-panel="deposits" hidden>
          <section class="rf-card">
            <div class="rf-card-head"><h3>Mobile check deposits</h3></div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Received</th><th>Customer</th><th>Reference</th><th>Check</th><th class="num">Amount</th><th>Status</th><th>Images</th><th></th></tr></thead>
                <tbody data-deposits><tr><td colspan="8" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
          </section>
        </section>

        <!-- ------------------------------------------------------- cards -- -->
        <section data-panel="cards" hidden>
          <section class="rf-card">
            <div class="rf-card-head"><h3>Issued cards</h3></div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Card</th><th>Customer</th><th>Type</th><th>Expires</th><th class="num">Daily limit</th><th>Status</th><th></th></tr></thead>
                <tbody data-cards><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
          </section>
        </section>

        <!-- ---------------------------------------------------- messages -- -->
        <section data-panel="messages" hidden>
          <div class="rf-grid side-left">
            <section class="rf-card">
              <div class="rf-card-head"><h3>Conversations</h3></div>
              <ul class="rf-list" data-threads><li class="rf-muted rf-small">Loading&hellip;</li></ul>
            </section>
            <section class="rf-card">
              <div class="rf-card-head"><h3 data-thread-subject>Choose a conversation</h3></div>
              <div class="rf-card-body" data-thread><p class="rf-muted rf-small">Nothing selected.</p></div>
              <div class="rf-card-foot">
                <form id="rf-console-reply">
                  <div class="rf-field"><textarea class="rf-textarea" name="body" placeholder="Reply to the customer" required></textarea></div>
                  <button class="rf-btn" type="submit" data-submit>Send reply</button>
                </form>
              </div>
            </section>
          </div>
        </section>

        <!-- ------------------------------------------------------ alerts -- -->
        <section data-panel="alerts" hidden>
          <div class="rf-grid side">
            <section class="rf-card">
              <div class="rf-card-head">
                <h3>Alerts sent</h3>
                <div class="rf-card-actions">
                  <select class="rf-select" data-alert-status style="width:auto">
                    <option value="">Every alert</option>
                    <option value="sent">Delivered</option>
                    <option value="failed">Failed</option>
                    <option value="not_configured">Not sent (no mail provider)</option>
                  </select>
                </div>
              </div>
              <div class="rf-table-wrap">
                <table class="rf-table">
                  <thead><tr><th>When</th><th>Customer</th><th>Subject</th><th>Type</th><th>Delivery</th><th>Read</th></tr></thead>
                  <tbody data-alerts><tr><td colspan="6" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
                </table>
              </div>
            </section>

            <section class="rf-card">
              <div class="rf-card-head"><h3>Send an email alert</h3></div>
              <div class="rf-card-body">
                <form id="rf-alert-form" novalidate>
                  <div class="rf-field">
                    <label for="al-audience">Send to</label>
                    <select class="rf-select" id="al-audience" name="audience">
                      <option value="one">One customer</option>
                      <option value="active">Every active customer</option>
                      <option value="all">Every customer</option>
                    </select>
                  </div>
                  <div class="rf-field" data-one-field>
                    <label for="al-customer">Customer</label>
                    <select class="rf-select" id="al-customer" name="userId"></select>
                  </div>
                  <div class="rf-field"><label for="al-subject">Subject</label><input class="rf-input" id="al-subject" name="subject" required /></div>
                  <div class="rf-field"><label for="al-intro">Opening line</label><input class="rf-input" id="al-intro" name="intro" /></div>
                  <div class="rf-field"><label for="al-body">Message</label><textarea class="rf-textarea" id="al-body" name="body" required></textarea></div>
                  <div class="rf-row">
                    <div class="rf-field"><label for="al-cta-label">Button label</label><input class="rf-input" id="al-cta-label" name="ctaLabel" /></div>
                    <div class="rf-field"><label for="al-cta-href">Button link</label><input class="rf-input" id="al-cta-href" name="ctaHref" /></div>
                  </div>
                  <label class="rf-check"><input type="checkbox" name="alsoMessage" checked /><span>Also put it in their secure inbox</span></label>
                  <div class="rf-notice rf-hide" data-mail-status></div>
                  <div class="rf-notice bad rf-hide" data-form-error></div>
                  <button class="rf-btn block" type="submit" data-submit>Send</button>
                </form>
              </div>
            </section>
          </div>
        </section>

        <!-- ---------------------------------------------------- disputes -- -->
        <section data-panel="disputes" hidden>
          <section class="rf-card">
            <div class="rf-card-head"><h3>Claims and disputes</h3></div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>Opened</th><th>Customer</th><th>Reference</th><th>Reason</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
                <tbody data-disputes><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
          </section>
        </section>

        <!-- ---------------------------------------------------- activity -- -->
        <section data-panel="activity" hidden>
          <section class="rf-card rf-mb">
            <div class="rf-card-body tight">
              <form class="rf-inline" data-activity-filters>
                <input class="rf-input" name="q" placeholder="Search actions, detail, email, IP" style="max-width:320px" />
                <select class="rf-select" name="category" style="width:auto"><option value="">Every category</option>${['security', 'money', 'account', 'admin'].map((c) => option(c)).join('')}</select>
                <select class="rf-select" name="severity" style="width:auto"><option value="">Any severity</option>${['info', 'notice', 'warning', 'critical'].map((c) => option(c)).join('')}</select>
                ${dateField({ id: 'al-from', name: 'from', label: 'From', from: -10, to: 0, wrapClass: 'rf-datefield' })}
                ${dateField({ id: 'al-to', name: 'to', label: 'To', from: -10, to: 0, wrapClass: 'rf-datefield' })}
                <button class="rf-btn sm" type="submit">Filter</button>
                <a class="rf-btn ghost sm" href="/api/bank/admin/activity/export">Export CSV</a>
              </form>
            </div>
          </section>
          <section class="rf-card">
            <div class="rf-card-head"><h3>Activity log</h3><div class="rf-card-actions rf-small rf-muted" data-activity-count></div></div>
            <div class="rf-table-wrap">
              <table class="rf-table">
                <thead><tr><th>When</th><th>Action</th><th>Who</th><th>Detail</th><th>Severity</th><th>IP</th><th>Device</th></tr></thead>
                <tbody data-activity><tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr></tbody>
              </table>
            </div>
            <div class="rf-card-foot rf-spread">
              <span data-activity-range></span>
              <span class="rf-inline">
                <button class="rf-btn ghost sm" data-activity-prev>Previous</button>
                <button class="rf-btn ghost sm" data-activity-next>Next</button>
              </span>
            </div>
          </section>
        </section>

        <!-- ---------------------------------------------------- settings -- -->
        <section data-panel="settings" hidden>
          <form id="rf-settings-form">
            <div class="rf-grid cols-2">
              <section class="rf-card">
                <div class="rf-card-head"><h3>The institution</h3></div>
                <div class="rf-card-body">
                  <div class="rf-field"><label for="st-name">Bank name</label><input class="rf-input" id="st-name" name="bankName" /></div>
                  <div class="rf-field"><label for="st-routing">Routing number</label><input class="rf-input mono" id="st-routing" name="routingNumber" maxlength="9" /><div class="hint">Checked against the ABA checksum before it saves.</div></div>
                  <div class="rf-field"><label for="st-email">Support email</label><input class="rf-input" id="st-email" name="supportEmail" /></div>
                  <div class="rf-field"><label for="st-announcement">Announcement banner</label><input class="rf-input" id="st-announcement" name="announcement" placeholder="Shown to everyone, signed in or not" /></div>
                  <div class="rf-row">
                    <div class="rf-field"><label for="st-announcement-level">Banner tone</label><select class="rf-select" id="st-announcement-level" name="announcementLevel">${['info', 'warn', 'bad', 'ok'].map((l) => option(l)).join('')}</select></div>
                    <div class="rf-field"><label for="st-session">Session timeout (minutes)</label><input class="rf-input" id="st-session" name="sessionMinutes" type="number" min="5" max="120" /></div>
                  </div>
                </div>
              </section>

              <section class="rf-card">
                <div class="rf-card-head"><h3>How to reach us</h3></div>
                <div class="rf-card-body">
                  <p class="rf-small rf-muted" style="margin:0 0 16px">Printed on the public site, quoted in every alert email, and given out as the beneficiary bank on an incoming wire. Nothing here ships with a value and nothing is invented for you: anything left blank is left off the page rather than shown empty.</p>
                  <div class="rf-row">
                    <div class="rf-field"><label for="st-phone">Client services</label><input class="rf-input" id="st-phone" name="supportPhone" type="tel" placeholder="1-800-000-0000" /></div>
                    <div class="rf-field"><label for="st-fraud-phone">Fraud line</label><input class="rf-input" id="st-fraud-phone" name="fraudPhone" type="tel" placeholder="Open around the clock" /></div>
                  </div>
                  <div class="rf-field"><label for="st-intl-phone">From outside the US</label><input class="rf-input" id="st-intl-phone" name="internationalPhone" type="tel" placeholder="+1 000 000 0000" /></div>
                  <div class="rf-field"><label for="st-hours">Opening hours</label><input class="rf-input" id="st-hours" name="supportHours" placeholder="Monday to Friday, 8:00am to 9:00pm ET" /></div>
                  <div class="rf-field"><label for="st-address">Mailing address</label><input class="rf-input" id="st-address" name="mailingAddress" placeholder="One line, as it would be written on an envelope" /><div class="hint">Also the beneficiary bank address on an incoming wire.</div></div>
                </div>
              </section>

              <section class="rf-card">
                <div class="rf-card-head"><h3>Verification and review</h3></div>
                <div class="rf-card-body">
                  <div class="rf-switch"><span class="t">One-time code on every outside transfer<small>Emailed before the transfer is accepted.</small></span><input type="checkbox" name="requireOtpForTransfers" /></div>
                  <div class="rf-switch"><span class="t">Transfer PIN required<small>For customers who have set one.</small></span><input type="checkbox" name="requirePinForTransfers" /></div>
                  <div class="rf-switch"><span class="t">Hold outside transfers for review<small>Nothing leaves until someone here releases it.</small></span><input type="checkbox" name="holdTransfersForReview" /></div>
                  <div class="rf-switch"><span class="t">Maintenance mode<small>Shows a banner across the site.</small></span><input type="checkbox" name="maintenanceMode" /></div>
                  <div class="rf-field rf-mt"><label for="st-hold">Always review above</label><input class="rf-input" id="st-hold" name="holdThresholdCents" inputmode="decimal" /></div>
                </div>
              </section>

              <section class="rf-card">
                <div class="rf-card-head"><h3>Daily limits</h3></div>
                <div class="rf-card-body rf-row" data-limits></div>
              </section>

              <section class="rf-card">
                <div class="rf-card-head"><h3>Fees</h3></div>
                <div class="rf-card-body rf-row" data-fees></div>
              </section>
            </div>
            <div class="rf-inline rf-mt">
              <button class="rf-btn" type="submit" data-submit>Save settings</button>
              <span class="rf-small rf-muted" data-mail-configured></span>
            </div>
          </form>
        </section>

        <!-- ------------------------------------------- customer drawer -- -->
        <div class="rf-modal-backdrop rf-hide" data-customer-modal>
          <div class="rf-modal wide">
            <div class="rf-modal-head">
              <span class="rf-avatar" data-modal-avatar>RF</span>
              <h3 data-modal-name>Customer</h3>
              <button type="button" data-close-modal aria-label="Close">&times;</button>
            </div>
            <div class="rf-modal-body" data-modal-body></div>
          </div>
        </div>

        <!-- ------------------------------------------------ adjust modal -- -->
        <div class="rf-modal-backdrop rf-hide" data-adjust-modal>
          <div class="rf-modal">
            <div class="rf-modal-head">
              <h3>Adjust a balance</h3>
              <button type="button" data-close-modal aria-label="Close">&times;</button>
            </div>
            <form id="rf-adjust-form">
              <div class="rf-modal-body">
                <p class="rf-small rf-muted" data-adjust-account></p>
                <div class="rf-row">
                  <div class="rf-field">
                    <label for="ad-direction">Direction</label>
                    <select class="rf-select" id="ad-direction" name="direction">
                      <option value="credit">Credit (money in)</option>
                      <option value="debit">Debit (money out)</option>
                    </select>
                  </div>
                  <div class="rf-field"><label for="ad-amount">Amount</label><input class="rf-input money" id="ad-amount" name="amount" inputmode="decimal" placeholder="0.00" required /></div>
                </div>
                <div class="rf-field"><label for="ad-description">Description on the statement</label><input class="rf-input" id="ad-description" name="description" placeholder="WIRE IN - ACME CORP PAYROLL" required /></div>
                <div class="rf-row three">
                  <div class="rf-field"><label for="ad-method">Method</label><select class="rf-select" id="ad-method" name="method">${Object.entries(TRANSACTION_METHODS).map(([id, m]) => option(id, m.label)).join('')}</select></div>
                  <div class="rf-field"><label for="ad-category">Category</label><select class="rf-select" id="ad-category" name="category">${CATEGORIES.map((c) => option(c)).join('')}</select></div>
                  <div class="rf-field"><label for="ad-status">Status</label><select class="rf-select" id="ad-status" name="status"><option value="posted">Posted</option><option value="pending">Pending</option></select></div>
                </div>
                <div class="rf-row">
                  ${dateField({ id: 'ad-date', name: 'date', label: 'Value date', from: -10, to: 1 })}
                  <div class="rf-field"><label for="ad-merchant">Merchant or counterparty</label><input class="rf-input" id="ad-merchant" name="counterpartyName" /></div>
                </div>
                <div class="rf-row">
                  <div class="rf-field"><label for="ad-bank">Counterparty bank</label><input class="rf-input" id="ad-bank" name="counterpartyBank" /></div>
                  <div class="rf-field"><label for="ad-check">Check number</label><input class="rf-input mono" id="ad-check" name="checkNumber" maxlength="10" /></div>
                </div>
                <div class="rf-field"><label for="ad-memo">Memo shown to the customer</label><input class="rf-input" id="ad-memo" name="memo" /></div>
                <div class="rf-field"><label for="ad-note">Internal note</label><input class="rf-input" id="ad-note" name="note" /></div>
                <label class="rf-check"><input type="checkbox" name="notify" checked /><span>Email the customer about this</span></label>
                <div class="rf-notice bad rf-hide" data-form-error></div>
              </div>
              <div class="rf-modal-foot">
                <button class="rf-btn ghost" type="button" data-close-modal>Cancel</button>
                <button class="rf-btn" type="submit" data-submit>Post the entry</button>
              </div>
            </form>
          </div>
        </div>

        <!-- ------------------------------------------------ reject modal -- -->
        <div class="rf-modal-backdrop rf-hide" data-reject-modal>
          <div class="rf-modal narrow">
            <div class="rf-modal-head"><h3>Return this transfer</h3><button type="button" data-close-modal aria-label="Close">&times;</button></div>
            <form id="rf-reject-form">
              <div class="rf-modal-body">
                <p class="rf-small rf-muted" data-reject-summary></p>
                <div class="rf-field">
                  <label for="rj-reason">Reason</label>
                  <select class="rf-select" id="rj-reason" name="reasonCode">${REJECTION_REASONS.map((r) => option(r.code, r.label)).join('')}</select>
                </div>
                <div class="rf-field"><label for="rj-note">What the customer will read</label><textarea class="rf-textarea" id="rj-note" name="note" style="min-height:80px"></textarea></div>
                <div class="rf-notice bad rf-hide" data-form-error></div>
              </div>
              <div class="rf-modal-foot">
                <button class="rf-btn ghost" type="button" data-close-modal>Cancel</button>
                <button class="rf-btn danger" type="submit" data-submit>Return the funds</button>
              </div>
            </form>
          </div>
        </div>

        <!-- ------------------------------------------------ account modal -- -->
        <div class="rf-modal-backdrop rf-hide" data-account-modal>
          <div class="rf-modal">
            <div class="rf-modal-head"><h3>Open an account</h3><button type="button" data-close-modal aria-label="Close">&times;</button></div>
            <form id="rf-open-account-form">
              <div class="rf-modal-body">
                <div class="rf-field">
                  <label for="oa-product">Product</label>
                  <select class="rf-select" id="oa-product" name="productId">${PRODUCTS.map((p) => option(p.id, p.name)).join('')}</select>
                </div>
                <div class="rf-row">
                  <div class="rf-field"><label for="oa-nickname">Nickname</label><input class="rf-input" id="oa-nickname" name="nickname" /></div>
                  <div class="rf-field"><label for="oa-opening">Opening balance</label><input class="rf-input money" id="oa-opening" name="openingBalance" inputmode="decimal" placeholder="0.00" /></div>
                </div>
                <div class="rf-row">
                  <div class="rf-field"><label for="oa-credit">Credit limit (credit cards)</label><input class="rf-input" id="oa-credit" name="creditLimit" inputmode="decimal" /></div>
                  <div class="rf-field"><label for="oa-overdraft">Overdraft limit</label><input class="rf-input" id="oa-overdraft" name="overdraftLimit" inputmode="decimal" /></div>
                </div>
                <label class="rf-check"><input type="checkbox" name="issueCard" checked /><span>Issue a card on this account</span></label>
                <div class="rf-notice bad rf-hide" data-form-error></div>
              </div>
              <div class="rf-modal-foot">
                <button class="rf-btn ghost" type="button" data-close-modal>Cancel</button>
                <button class="rf-btn" type="submit" data-submit>Open the account</button>
              </div>
            </form>
          </div>
        </div>`;

module.exports = [
  {
    file: 'console.html',
    build: appPage,
    opts: {
      title: `Staff console | ${BANK.name}`,
      description: 'Rockfield staff console.',
      heading: 'Staff console',
      sub: 'Customers, money movement and everything that has been done today.',
      active: 'console',
      content,
      extraScripts: ['/js/bank/console.js'],
      actions: '<span class="rf-badge info dot" data-staff-badge>Staff</span>',
    },
  },
];
