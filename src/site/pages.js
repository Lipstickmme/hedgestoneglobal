'use strict';

/**
 * The public bank site: everything a visitor can read without signing in.
 *
 * Rendered to static HTML at build time by scripts/build-pages.js. The pages
 * use the bank's own shell (src/bank/site/layout.js) and its component CSS.
 *
 * Three pieces of markup are load-bearing for scripts the site inherited from
 * the template and must keep their shape: the enquiry form below (which
 * /js/main.js validates and submits to /api/contact), `#roles` on the careers
 * page (filled by /js/careers.js from /api/careers), and `#apply-form` on the
 * apply page (/js/apply.js). Anything carrying `data-site` is kept in step
 * with the contact details held at the client services desk.
 */

const services = require('../data/services.json');
const stories = require('../data/projects.json');
const leadership = require('../data/leadership.json');
const site = require('../data/site.json');
const images = require('./images');
const { page } = require('./layout');
const { marketingPage, icon, productCard } = require('../bank/site/layout');
const { BANK, PRODUCTS } = require('../bank/constants');

const YEAR = new Date().getFullYear();
const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ------------------------------------------------------------- components -- */

/**
 * The page-top band on an interior page.
 *
 * Every page that has a photograph has its own - the slots in
 * src/data/images.json are one-to-one with placements precisely so nobody
 * meets the same picture twice. The two that do not (apply, disclosures) get
 * the mark drawn large and faint instead, which is better than a tenth page
 * borrowing a ninth page's photograph.
 */
function header({ eyebrow, title, lede, image }) {
  return `
  <header class="rf-hero compact ${image ? 'has-photo' : 'has-mark'}">
    ${image
      ? `<img class="rf-hero-photo" src="${image}" alt="" aria-hidden="true" />`
      : `<img class="rf-hero-mark" src="/assets/bank/logomark-light.png" alt="" aria-hidden="true" width="940" height="499" />`}
    <div class="wrap">
      <span class="rf-eyebrow">${eyebrow}</span>
      <h1 style="font-size:clamp(32px,4.6vw,52px)">${title}</h1>
      ${lede ? `<p class="lede">${lede}</p>` : ''}
    </div>
  </header>`;
}

/**
 * The enquiry form. Shared by the home page, /contact and /open-account so all
 * three behave identically: each POSTs to /api/contact, and each lands on the
 * client services desk at /admin.
 */
function enquiryForm(id = 'contact-form', { heading, note } = {}) {
  return `
      <form class="rf-card" id="${id}" data-contact-form novalidate style="padding:24px">
        ${heading ? `<h3 style="font-family:var(--rf-display);font-size:19px;margin:0 0 4px">${heading}</h3>` : ''}
        ${note ? `<p class="rf-small rf-muted" style="margin:0 0 18px">${note}</p>` : ''}
        <div class="rf-row">
          <div class="rf-field field"><label for="${id}-name">Name</label><input class="rf-input" type="text" id="${id}-name" name="name" autocomplete="name" required /><div class="err" data-err="name"></div></div>
          <div class="rf-field field"><label for="${id}-email">Email</label><input class="rf-input" type="email" id="${id}-email" name="email" autocomplete="email" required /><div class="err" data-err="email"></div></div>
        </div>
        <div class="rf-row">
          <div class="rf-field field"><label for="${id}-company">Phone <span class="rf-muted">(optional)</span></label><input class="rf-input" type="text" id="${id}-company" name="company" autocomplete="tel" /><div class="err" data-err="company"></div></div>
          <div class="rf-field field"><label for="${id}-service">What is this about?</label>
            <select class="rf-select" id="${id}-service" name="service">
              <option value="">Select</option>
              <option>Opening an account</option>
              <option>An existing account</option>
              <option>A payment or transfer</option>
              <option>Fraud or a disputed transaction</option>
              <option>Borrowing</option>
              <option>Business banking</option>
              <option>Careers</option>
              <option>Something else</option>
            </select><div class="err" data-err="service"></div>
          </div>
        </div>
        <div class="rf-field field"><label for="${id}-message">How can we help?</label><textarea class="rf-textarea" id="${id}-message" name="message" placeholder="Tell us what you need. Never include a password, a full card number or a one-time code." required></textarea><div class="err" data-err="message"></div></div>
        <div class="honeypot" aria-hidden="true" style="position:absolute;left:-9999px"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
        <div class="form-status rf-small" data-form-status role="status" aria-live="polite"></div>
        <button type="submit" class="rf-btn block" data-submit>Send message</button>
        <p class="rf-small rf-muted" style="margin:12px 0 0">A banker replies the same business day. For anything urgent, call <strong data-site="phone">our client services desk</strong>.</p>
      </form>`;
}

const tick = icon('check', 15);

/* ===================================================================== home == */

const ceo = leadership[0];

const homeContent = `
  <section class="rf-hero tall has-photo">
    <img class="rf-hero-photo" src="${images.hero}" alt="" aria-hidden="true" fetchpriority="high" />
    <div class="wrap">
      <div class="rf-hero-copy">
        <span class="rf-eyebrow">Established ${BANK.established}</span>
        <h1>Banking built<br />on bedrock.</h1>
        <p class="lede">Checking with no monthly fee. Savings at 4.35% APY. And a payments team that reads every outgoing wire before it leaves.</p>
        <div class="rf-hero-actions">
          <a class="rf-btn brass lg" href="/open-account">Open an account</a>
          <a class="rf-btn glass lg" href="/signin">Sign in to online banking</a>
        </div>
      </div>
      <div class="rf-hero-stats rf-glass">
        <div><div class="k">Savings APY</div><div class="v">4.35%</div></div>
        <div><div class="k">Monthly fee</div><div class="v">$0.00</div></div>
        <div><div class="k">Fee-free ATMs</div><div class="v">60,000</div></div>
        <div><div class="k">Fraud line</div><div class="v">24 / 7</div></div>
      </div>
    </div>
  </section>

  <section class="rf-section alt">
    <div class="wrap">
      <span class="rf-eyebrow">Accounts</span>
      <h2>Open in ten minutes. Useful from the first day.</h2>
      <p class="section-lede">No monthly fee on Everyday Checking, no minimum on savings, and a rate that does not quietly expire after three months.</p>
      <div class="rf-grid cols-3">
        ${PRODUCTS.filter((p) => ['everyday_checking', 'high_yield_savings', 'rockfield_signature_card'].includes(p.id)).map(productCard).join('')}
      </div>
      <p style="margin-top:26px"><a class="rf-btn ghost" href="/personal">All personal accounts</a></p>
    </div>
  </section>

  <section class="rf-section">
    <div class="wrap">
      <span class="rf-eyebrow">Moving money</span>
      <h2>Every payment leaves a receipt you can quote.</h2>
      <p class="section-lede">ACH, wires, bill pay and instant sends, each with a confirmation number and, where the network gives one, a real ACH trace number or Fedwire IMAD. When something goes missing, that is the difference between a search and a shrug.</p>
      <div class="rf-grid cols-3">
        <div class="rf-card rf-stat"><div class="k">ACH transfer</div><div class="v">Free</div><div class="d">1 to 3 business days</div></div>
        <div class="rf-card rf-stat"><div class="k">Domestic wire</div><div class="v">$25.00</div><div class="d">Same day before 4:00pm ET</div></div>
        <div class="rf-card rf-stat"><div class="k">International wire</div><div class="v">$45.00</div><div class="d">2 to 5 business days</div></div>
      </div>
      <p style="margin-top:26px"><a class="rf-btn ghost" href="/rates">The full fee schedule</a></p>
    </div>
  </section>

  <section class="rf-section alt">
    <div class="wrap">
      <div class="rf-grid side" style="gap:44px;align-items:center">
        <div>
          <span class="rf-eyebrow">Security</span>
          <h2>Held before it leaves, not chased afterwards.</h2>
          <p class="section-lede">A one-time code on every sign-in and every outside payment. A transfer PIN of your own. New recipients read by a person before the first payment reaches them. Alerts within seconds, wherever the money went.</p>
          <div class="rf-grid cols-2" style="gap:22px">
            <div class="rf-feature"><span class="ic">${icon('lock', 18)}</span><div><h3>Two-step verification</h3><p>On every sign-in, and again before an outside transfer is accepted.</p></div></div>
            <div class="rf-feature"><span class="ic">${icon('bell', 18)}</span><div><h3>Instant alerts</h3><p>Sign-ins, payments, card activity and profile changes, as they happen.</p></div></div>
            <div class="rf-feature"><span class="ic">${icon('card', 18)}</span><div><h3>Freeze in a tap</h3><p>Lock a card, set daily limits, turn international use on or off.</p></div></div>
            <div class="rf-feature"><span class="ic">${icon('shield', 18)}</span><div><h3>Zero liability</h3><p>You are not liable for unauthorised card transactions reported promptly.</p></div></div>
          </div>
          <p style="margin-top:26px"><a class="rf-btn ghost" href="/security-center">Visit the security centre</a></p>
        </div>
        <div>
          <img src="${images.homeSecurity}" alt="" loading="lazy" style="width:100%;border-radius:var(--rf-radius-lg);box-shadow:var(--rf-shadow-lg)" />
        </div>
      </div>
    </div>
  </section>

  <section class="rf-section">
    <div class="wrap">
      <span class="rf-eyebrow">Business banking</span>
      <h2>For businesses with a cash cycle, not a hobby.</h2>
      <p class="section-lede">Dual approval on outgoing payments, role-based access so a bookkeeper can reconcile without moving money, same-day ACH origination and next-business-day merchant settlement.</p>
      <div class="rf-grid cols-2">
        ${stories.slice(0, 2).map((story) => `
        <article class="rf-card">
          <img src="${images.story(story.image)}" alt="" loading="lazy" style="width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:var(--rf-radius) var(--rf-radius) 0 0;display:block" />
          <div class="rf-card-body">
            <span class="rf-eyebrow">${story.sector} &middot; ${story.location}</span>
            <h3 style="font-family:var(--rf-display);font-size:20px;margin:6px 0 8px">${story.name}</h3>
            <p class="rf-muted" style="margin:0 0 14px">${story.blurb}</p>
            <div class="rf-spread">
              <span class="rf-inline"><strong class="rf-amt">${story.metric}</strong><span class="rf-small rf-muted">${story.metricLabel}</span></span>
              <span class="rf-badge">${story.status}</span>
            </div>
          </div>
        </article>`).join('')}
      </div>
      <p style="margin-top:26px"><a class="rf-btn ghost" href="/business">Business banking</a></p>
    </div>
  </section>

  <section class="rf-section alt">
    <div class="wrap" style="max-width:820px;text-align:center">
      <blockquote style="font-family:var(--rf-headline);font-weight:500;font-style:italic;font-size:clamp(24px,3vw,36px);line-height:1.32;letter-spacing:0;margin:0 0 18px">
        &ldquo;${ceo.quote}&rdquo;
      </blockquote>
      <div class="rf-small rf-muted"><strong>${ceo.name}</strong> &middot; ${ceo.role}</div>
    </div>
  </section>

  <section class="rf-section" id="contact">
    <div class="wrap">
      <div class="rf-grid side" style="gap:44px;align-items:start">
        <div>
          <span class="rf-eyebrow">Talk to us</span>
          <h2>A person on the phone, not a menu.</h2>
          <dl class="rf-dl" style="max-width:460px">
            <dt data-site-row="phone" hidden>Phone</dt><dd data-site-row="phone" data-site="phone" hidden></dd>
            <dt>Email</dt><dd><a href="mailto:${site.email}" data-site="email">${site.email}</a></dd>
            <dt data-site-row="hours" hidden>Hours</dt><dd data-site-row="hours" data-site="hours" hidden></dd>
            <dt data-site-row="fraudPhone" hidden>Fraud, any hour</dt><dd data-site-row="fraudPhone" data-site="fraudPhone" hidden></dd>
            <dt data-site-row="address" hidden>Post</dt><dd data-site-row="address" data-site="address" hidden></dd>
          </dl>
          <div class="rf-notice warn" style="margin-top:22px">
            <div><strong>We will never ask for a code.</strong>Not by phone, text or email. Signed-in customers can use secure messages for anything about a specific account.</div>
          </div>
        </div>
        ${enquiryForm('home-contact-form', { heading: 'Send us a message', note: 'A banker replies the same business day.' })}
      </div>
    </div>
  </section>`;

/* ================================================================= personal == */

const personalContent = `
  ${header({
    eyebrow: 'Personal banking',
    title: 'Accounts that behave.',
    lede: 'Checking, savings, certificates and a card, priced so the headline number is the one you actually get.',
    image: images.personalHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <span class="rf-eyebrow">Open an account</span>
      <h2>Everything we offer, side by side.</h2>
      <div class="rf-grid cols-3">${PRODUCTS.map(productCard).join('')}</div>
    </div>
  </section>

  <section class="rf-section alt">
    <div class="wrap">
      <span class="rf-eyebrow">What comes with all of it</span>
      <h2>The parts that are not on the rate sheet.</h2>
      <div class="rf-grid cols-2">
        ${services.map((service) => `
        <article class="rf-card">
          <div class="rf-card-body">
            <h3 style="font-family:var(--rf-display);font-size:18px;margin:0 0 8px">${service.title}</h3>
            <p class="rf-muted" style="margin:0 0 14px">${service.summary}</p>
            <ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px">
              ${service.points.map((point) => `<li class="rf-small" style="display:flex;gap:9px;align-items:flex-start"><span style="color:var(--rf-credit)">${tick}</span><span>${point}</span></li>`).join('')}
            </ul>
          </div>
        </article>`).join('')}
      </div>
    </div>
  </section>`;

/* ================================================================= business == */

const businessContent = `
  ${header({
    eyebrow: 'Business banking',
    title: 'Banking that keeps up with the business.',
    lede: 'Operating accounts, payroll, merchant settlement and credit, with dual approval and role-based access as standard.',
    image: images.businessHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <span class="rf-eyebrow">How it works</span>
      <h2>Controls first, then convenience.</h2>
      <p class="section-lede">Nobody moves money on their own unless you decide they can. Approvals, limits and read-only access are set when the account opens, not bolted on after an incident.</p>
      <div class="rf-grid cols-3">
        <div class="rf-card rf-stat"><div class="k">Dual approval</div><div class="v">Standard</div><div class="d">On every payment over your threshold</div></div>
        <div class="rf-card rf-stat"><div class="k">Same-day ACH</div><div class="v">Included</div><div class="d">Origination cut-off 2:45pm ET</div></div>
        <div class="rf-card rf-stat"><div class="k">Merchant settlement</div><div class="v">Next day</div><div class="d">With store-level references</div></div>
      </div>
    </div>
  </section>

  <section class="rf-section alt">
    <div class="wrap">
      <span class="rf-eyebrow">Client stories</span>
      <h2>What it looks like in practice.</h2>
      <div class="rf-grid cols-2">
        ${stories.map((story) => `
        <article class="rf-card">
          <img src="${images.story(story.image)}" alt="" loading="lazy" style="width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:var(--rf-radius) var(--rf-radius) 0 0;display:block" />
          <div class="rf-card-body">
            <span class="rf-eyebrow">${story.sector} &middot; ${story.location}</span>
            <h3 style="font-family:var(--rf-display);font-size:20px;margin:6px 0 8px">${story.name}</h3>
            <p class="rf-muted" style="margin:0 0 14px">${story.overview}</p>
            <div class="rf-spread">
              <span class="rf-inline"><strong class="rf-amt">${story.metric}</strong><span class="rf-small rf-muted">${story.metricLabel}</span></span>
              <span class="rf-badge">${story.status}</span>
            </div>
          </div>
        </article>`).join('')}
      </div>
      <p style="margin-top:28px"><a class="rf-btn" href="/open-account?product=premier_checking">Open a business account</a></p>
    </div>
  </section>`;

/* ==================================================================== rates == */

const FEES = [
  ['Monthly service fee, Everyday Checking', 'None'],
  ['Monthly service fee, Premier Interest Checking', '$25.00, waived at $2,500 average balance'],
  ['Outgoing ACH transfer', 'None'],
  ['Outgoing domestic wire', '$25.00'],
  ['Outgoing international wire', '$45.00'],
  ['Incoming wire', 'None'],
  ['Expedited transfer', '$10.00'],
  ['Overdraft item', '$34.00, maximum three per day'],
  ['Returned item', '$34.00'],
  ['Stop payment', '$30.00'],
  ['Out-of-network ATM', '$2.50 plus the operator&rsquo;s fee'],
  ['Foreign transaction', 'None'],
  ['Card replacement', 'None, or $25.00 expedited'],
  ['Paper statement', '$2.00 each'],
  ['Account research, per hour', '$25.00'],
];

const ratesContent = `
  ${header({
    eyebrow: 'Rates and fees',
    title: 'What it pays, and what it costs.',
    lede: 'Everything on one page. Rates are variable and may change after account opening.',
    image: images.ratesHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <span class="rf-eyebrow">Deposit rates</span>
      <h2>Annual Percentage Yield.</h2>
      <div class="rf-card">
        <div class="rf-table-wrap">
          <table class="rf-table">
            <thead><tr><th>Account</th><th class="num">APY</th><th class="num">Minimum to open</th><th class="num">Monthly fee</th></tr></thead>
            <tbody>
              ${PRODUCTS.filter((p) => p.type !== 'credit').map((p) => `<tr>
                <td><strong>${p.name}</strong><span class="sub">${p.blurb}</span></td>
                <td class="num">${p.apy ? `${p.apy.toFixed(2)}%` : '&mdash;'}</td>
                <td class="num">${money(p.minimumBalance || 0)}</td>
                <td class="num">${money(p.monthlyFee || 0)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <h2 style="margin-top:48px">Every fee we charge.</h2>
      <div class="rf-card">
        <div class="rf-table-wrap">
          <table class="rf-table">
            <thead><tr><th>Service</th><th class="num">Fee</th></tr></thead>
            <tbody>${FEES.map(([label, value]) => `<tr><td>${label}</td><td class="num">${value}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>

      <p class="rf-disclosure" style="margin-top:24px">
        Annual Percentage Yields are accurate as of ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })} and are variable: they may change before or after an
        account is opened. Fees may reduce earnings. A penalty may be imposed for early withdrawal from a certificate. Credit products are subject to credit
        approval, and the APR shown is the rate available to applicants with the strongest credit profile.
      </p>
    </div>
  </section>`;

/* ========================================================== security centre == */

const securityCentreContent = `
  ${header({
    eyebrow: 'Security centre',
    title: 'How we protect the account, and how you can.',
    lede: 'What runs on our side, what to switch on for yours, and what to do the moment something looks wrong.',
    image: images.securityHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <div class="rf-notice bad">
        <div><strong>We will never ask for a one-time code.</strong>
        Not by phone, not by text, not by email. If anyone asks for a code, a password or your full card number, hang up and call <span data-site="fraudPhone">our fraud line</span>.</div>
      </div>

      <h2 style="margin-top:34px">What runs whether you think about it or not.</h2>
      <div class="rf-grid cols-2" style="gap:24px">
        <div class="rf-feature"><span class="ic">${icon('shield', 18)}</span><div><h3>Held review on outgoing payments</h3><p>Transfers to somebody new are read by our payments team before the money leaves.</p></div></div>
        <div class="rf-feature"><span class="ic">${icon('lock', 18)}</span><div><h3>Encrypted at rest</h3><p>Social Security numbers and identity documents are encrypted with keys the application cannot print.</p></div></div>
        <div class="rf-feature"><span class="ic">${icon('activity', 18)}</span><div><h3>Every action logged</h3><p>Who did what, from which device and address. You can read your own history under Activity.</p></div></div>
        <div class="rf-feature"><span class="ic">${icon('user', 18)}</span><div><h3>Sessions you control</h3><p>See every signed-in device and sign any of them out, from anywhere.</p></div></div>
      </div>

      <h2 style="margin-top:48px">Four things worth ten minutes.</h2>
      <div class="rf-card"><div class="rf-card-body">
        <ol style="margin:0;padding-left:20px;line-height:2.1">
          <li>Turn on two-step verification, and leave it on.</li>
          <li>Set a transfer PIN that is not your card PIN.</li>
          <li>Set the alert threshold low enough to be slightly annoying.</li>
          <li>Add the people you pay regularly as recipients, so a new one is genuinely unusual.</li>
        </ol>
      </div></div>

      <h2 style="margin-top:48px">If something is wrong, call first.</h2>
      <div class="rf-grid cols-3">
        <div class="rf-card rf-stat"><div class="k">Fraud line, 24/7</div><div class="v" style="font-size:20px" data-site="fraudPhone">Open around the clock</div><div class="d">Cards, transfers, anything urgent</div></div>
        <div class="rf-card rf-stat"><div class="k">General support</div><div class="v" style="font-size:20px" data-site="phone">Six days a week</div><div class="d" data-site="hours">${site.hours}</div></div>
        <div class="rf-card rf-stat"><div class="k">Report a phishing email</div><div class="v" style="font-size:16px">${BANK.securityEmail}</div><div class="d">Forward it; do not click anything in it</div></div>
      </div>
    </div>
  </section>`;

/* ============================================================= open account == */

const openAccountContent = `
  ${header({
    eyebrow: 'Open an account',
    title: 'Start the application.',
    lede: 'Tell us what you need and a banker calls you back the same business day to finish it with you.',
    image: images.openAccountHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <div class="rf-grid side" style="gap:44px;align-items:start">
        <div>
          <h2 style="font-size:26px">What you will need</h2>
          <dl class="rf-dl" style="max-width:480px">
            <dt>Identity</dt><dd>A driver&rsquo;s licence, state ID or passport</dd>
            <dt>Tax</dt><dd>Your Social Security number or ITIN</dd>
            <dt>Address</dt><dd>Somewhere we can post a card</dd>
            <dt>Opening deposit</dt><dd>From $0 on Everyday Checking</dd>
          </dl>
          <div class="rf-notice" style="margin-top:22px">
            <div><strong>Why this is a message and not a form full of secrets.</strong>
            Accounts at ${BANK.shortName} are opened by a banker who verifies your identity properly. Never send a Social Security number, a password or a card number through a web form.</div>
          </div>
          <p style="margin-top:22px"><a class="rf-btn ghost" href="/rates">See rates and fees first</a></p>
        </div>
        ${enquiryForm('open-account-form', { heading: 'Tell us what you need', note: 'A banker calls you back the same business day.' })}
      </div>
    </div>
  </section>`;

/* =================================================================== careers == */

const careersContent = `
  ${header({
    eyebrow: 'Careers',
    title: 'Work somewhere the ledger has to balance.',
    lede: 'Retail, payments, financial crime, compliance, lending and technology. On site, hybrid and remote.',
    image: images.careersHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <div class="rf-grid side" style="gap:44px;align-items:start">
        <div>
          <span class="rf-eyebrow">Life at ${BANK.shortName}</span>
          <h2>Small enough to know what you changed.</h2>
          <p class="section-lede">We are a national bank of about 900 people. Nobody here is four layers from a customer: a payments analyst sees the transfer they released land, and whoever changes the ledger sits close enough to the branch to hear when it went wrong. We pay at market, promote from inside, and do not run a graduate scheme that keeps people away from real work for a year.</p>
        </div>
        <div class="rf-card"><div class="rf-card-body">
          <h3 style="font-family:var(--rf-display);margin:0 0 10px">What we offer</h3>
          <ul style="list-style:none;padding:0;margin:0;display:grid;gap:9px">
            ${['Health, dental and vision from day one', '6% 401(k) match, vested immediately', '20 days leave and a week at the holidays', 'Tuition support for banking qualifications', 'Hybrid by default, remote where the role allows']
    .map((point) => `<li class="rf-small" style="display:flex;gap:9px"><span style="color:var(--rf-credit)">${tick}</span><span>${point}</span></li>`).join('')}
          </ul>
        </div></div>
      </div>
    </div>
  </section>

  <section class="rf-section alt">
    <div class="wrap">
      <span class="rf-eyebrow">Open roles</span>
      <h2>Where we are hiring.</h2>
      <p class="section-lede">If your discipline is not listed, write to us anyway and say what you would want to work on.</p>
      <div class="roles" id="roles"></div>
      <p style="margin-top:28px"><a class="rf-btn ghost" href="/apply">Send a speculative application</a></p>
    </div>
  </section>`;

/* ===================================================================== apply == */

const applyContent = `
  ${header({ eyebrow: 'Careers', title: 'Apply.', lede: 'One form, read by the people you would work with. We reply to everyone.' })}

  <section class="rf-section">
    <div class="wrap">
      <div class="rf-grid side" style="gap:44px;align-items:start">
        <div>
          <h2 id="apply-role-title" style="font-size:26px">Speculative application</h2>
          <p class="section-lede" id="apply-role-sub">Tell us what you have worked on and where you want to take it next.</p>
          <dl class="rf-dl" id="apply-role-meta" style="max-width:420px"></dl>
          <div class="rf-notice" style="margin-top:20px">
            <div><strong>We read every application ourselves.</strong>If your experience does not line up with an open role we will say so, and say what would change that.</div>
          </div>
          <p style="margin-top:20px"><a class="rf-btn ghost" href="/careers">All open roles</a></p>
        </div>

        <form class="rf-card" id="apply-form" novalidate style="padding:24px">
          <div class="rf-row">
            <div class="rf-field field"><label for="apply-name">Name</label><input class="rf-input" type="text" id="apply-name" name="name" autocomplete="name" required /><div class="err" data-err="name"></div></div>
            <div class="rf-field field"><label for="apply-email">Email</label><input class="rf-input" type="email" id="apply-email" name="email" autocomplete="email" required /><div class="err" data-err="email"></div></div>
          </div>
          <div class="rf-row">
            <div class="rf-field field"><label for="apply-phone">Phone <span class="rf-muted">(optional)</span></label><input class="rf-input" type="tel" id="apply-phone" name="phone" autocomplete="tel" /><div class="err" data-err="phone"></div></div>
            <div class="rf-field field"><label for="apply-experience">Years in the industry</label>
              <select class="rf-select" id="apply-experience" name="experience">
                <option value="">Select</option>
                <option>New to banking</option>
                <option>1 to 3</option>
                <option>4 to 8</option>
                <option>9 to 15</option>
                <option>15 or more</option>
              </select><div class="err" data-err="experience"></div>
            </div>
          </div>
          <div class="rf-field field"><label for="apply-role">Role</label>
            <select class="rf-select" id="apply-role" name="roleId"><option value="">Speculative application</option></select>
            <div class="err" data-err="roleId"></div>
          </div>
          <div class="rf-field field"><label for="apply-portfolio">LinkedIn or portfolio <span class="rf-muted">(optional)</span></label><input class="rf-input" type="url" id="apply-portfolio" name="portfolio" placeholder="https://" /><div class="err" data-err="portfolio"></div></div>
          <div class="rf-field field"><label for="apply-message">What have you worked on?</label><textarea class="rf-textarea" id="apply-message" name="message" placeholder="The work you would want us to ask about, and what you did on it." required></textarea><div class="err" data-err="message"></div></div>
          <div class="honeypot" aria-hidden="true" style="position:absolute;left:-9999px"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
          <div class="form-status rf-small" id="apply-status" role="status" aria-live="polite"></div>
          <button type="submit" class="rf-btn block" id="apply-submit">Send application</button>
        </form>
      </div>
    </div>
  </section>`;

/* =================================================================== contact == */

const contactContent = `
  ${header({
    eyebrow: 'Support',
    title: 'Talk to us.',
    lede: 'Client services six days a week, with a fraud line that never closes.',
    image: images.contactHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <div class="rf-grid side" style="gap:44px;align-items:start">
        <div>
          <dl class="rf-dl" style="max-width:480px">
            <dt data-site-row="phone" hidden>Phone</dt><dd data-site-row="phone" data-site="phone" hidden></dd>
            <dt>Email</dt><dd><a href="mailto:${site.email}" data-site="email">${site.email}</a></dd>
            <dt data-site-row="hours" hidden>Hours</dt><dd data-site-row="hours" data-site="hours" hidden></dd>
            <dt data-site-row="fraudPhone" hidden>Fraud, any hour</dt><dd data-site-row="fraudPhone" data-site="fraudPhone" hidden></dd>
            <dt data-site-row="internationalPhone" hidden>International</dt><dd data-site-row="internationalPhone" data-site="internationalPhone" hidden></dd>
            <dt data-site-row="address" hidden>Post</dt><dd data-site-row="address" data-site="address" hidden></dd>
          </dl>

          <h3 style="font-family:var(--rf-display);margin:30px 0 10px">Already banking with us?</h3>
          <p class="rf-muted rf-small">Secure messages inside online banking are the safe place for anything about a specific account. They sit inside your session, so account numbers are fine to include.</p>
          <p><a class="rf-btn ghost" href="/signin">Sign in to online banking</a></p>

          <div class="rf-notice warn" style="margin-top:22px">
            <div><strong>Never send a secret here.</strong>No passwords, no full card numbers, no one-time codes. We will never ask for them.</div>
          </div>
        </div>
        ${enquiryForm('contact-form', { heading: 'Send us a message', note: 'We reply the same business day.' })}
      </div>
    </div>
  </section>`;

/* ===================================================================== legal == */

const legalContent = `
  ${header({ eyebrow: 'Legal', title: 'Disclosures.', lede: 'The agreements and notices that govern an account at Rockfield.' })}

  <section class="rf-section">
    <div class="wrap" style="max-width:820px">
      <article class="rf-card"><div class="rf-card-body">
        <h2 id="privacy" style="font-family:var(--rf-display);margin-top:0;font-size:21px">Privacy notice</h2>
        <p class="rf-muted">${BANK.legalName} collects the information needed to open and run your accounts: your name, address, date of birth, Social Security number, identification documents, transaction history and the devices you use to reach us. We share it only with the service providers who help us run the bank, and with regulators and law enforcement where the law requires it. We do not sell it.</p>
        <p class="rf-muted">You may limit marketing at any time under Alerts inside online banking, or by calling <span data-site="phone">client services</span>.</p>

        <h2 id="terms" style="font-family:var(--rf-display);font-size:21px">Online banking agreement</h2>
        <p class="rf-muted">Access to online banking is personal to you. Keep your password and one-time codes to yourself, tell us immediately if you think someone else has them, and review your statements. We may hold, delay or decline a payment where we reasonably suspect fraud, where it would breach a limit, or where sanctions screening requires a manual check. Where we decline one, the funds return to your available balance and you are told why.</p>

        <h2 id="disclosures" style="font-family:var(--rf-display);font-size:21px">Truth in Savings</h2>
        <p class="rf-muted">Annual Percentage Yields are variable and may change at any time after an account is opened. Interest is compounded and credited monthly. Fees may reduce earnings. A penalty may be imposed for early withdrawal from a certificate. Minimum balance requirements, where they apply, are shown on the rates page and in your account agreement.</p>

        <h2 id="funds" style="font-family:var(--rf-display);font-size:21px">Funds availability</h2>
        <p class="rf-muted">For checks deposited through mobile deposit, the first $225 is generally available on the first business day after the day of deposit, and the remainder by the second business day. We may place a longer hold in the circumstances permitted by Regulation CC, and we will tell you when we do.</p>

        <h2 id="accessibility" style="font-family:var(--rf-display);font-size:21px">Accessibility</h2>
        <p class="rf-muted">We aim to meet WCAG 2.2 AA across online banking. If any part of this site is difficult to use, tell us on <span data-site="phone">the client services line</span> or <a href="mailto:${site.email}" data-site="email">${site.email}</a> and we will help you complete what you were doing and fix the underlying problem.</p>

        <h2 id="demo" style="font-family:var(--rf-display);font-size:21px">About this application</h2>
        <p class="rf-muted">${BANK.legalName} is a fictional institution. This site is a demonstration of a banking application: the routing number, account numbers, card numbers and customer records used throughout are synthetic, reach no real financial institution, and no real money can move through it.</p>
      </div></article>
    </div>
  </section>`;

/* ======================================================================= 404 == */

const notFoundContent = `
  <section class="rf-hero has-mark" style="min-height:60vh;display:flex;align-items:center">
    <img class="rf-hero-mark" src="/assets/bank/logomark-light.png" alt="" aria-hidden="true" width="940" height="499" />
    <div class="wrap">
      <span class="rf-eyebrow">Error 404</span>
      <h1>Not on the books.</h1>
      <p class="lede">This page has moved or never existed. The links below will get you back.</p>
      <div class="rf-hero-actions">
        <a class="rf-btn brass" href="/">Back to home</a>
        <a class="rf-btn ghost" href="/signin">Sign in</a>
      </div>
    </div>
  </section>`;

/* ================================================= client services desk (staff) == */

const deskContent = `
  <main class="admin" id="admin">
    <section class="admin-gate" id="admin-boot">
      <div class="admin-card"><p class="admin-note">Checking access&hellip;</p></div>
    </section>

    <section class="admin-gate" id="admin-unconfigured" hidden>
      <div class="admin-card">
        <span class="eyebrow">Rockfield / Client services desk</span>
        <h1>Backend not connected.</h1>
        <div id="admin-missing"></div>
        <p class="admin-note">Set it in the deployment's environment variables and reload. Nothing needs rebuilding, but the change only reaches a running deployment after a redeploy.</p>
        <p class="admin-note"><a href="/api/health">/api/health</a> lists everything the server can see.</p>
        <a class="admin-back" href="/">Back to site</a>
      </div>
    </section>

    <section class="admin-gate" id="admin-login" hidden>
      <form class="admin-card" id="login-form" novalidate>
        <span class="eyebrow">Rockfield / Client services desk</span>
        <h1>Staff sign in.</h1>
        <p class="admin-note" id="login-note">Website enquiries, live chat and the shared mailbox. Customer accounts are in the <a href="/console">banking console</a>.</p>
        <div class="field"><label for="login-email">Email</label><input type="email" id="login-email" name="email" autocomplete="username" required /></div>
        <div class="field"><label for="login-password">Password</label><input type="password" id="login-password" name="password" autocomplete="current-password" required /></div>
        <div class="err" id="login-error" role="alert"></div>
        <button type="submit" class="btn" id="login-btn">Sign in <span class="arw">&rsaquo;</span></button>
        <a class="admin-back" href="/">Back to site</a>
      </form>
    </section>

    <div class="admin-shell" id="admin-shell" hidden>
      <header class="admin-bar">
        <a class="admin-brand" href="/">
          <img src="/assets/bank/logo-light.png" alt="Rockfield National Bank" width="240" height="143" />
          <span>Client services desk</span>
        </a>
        <div class="admin-bar-end">
          <a class="admin-signout" href="/console" style="text-decoration:none">Banking console</a>
          <span class="admin-who" id="admin-who"></span>
          <button type="button" class="admin-signout" id="admin-signout">Sign out</button>
        </div>
      </header>

      <nav class="admin-tabs" id="admin-tabs" role="tablist" aria-label="Sections">
        <button type="button" class="admin-tab is-active" role="tab" data-tab="enquiries" aria-selected="true">Enquiries<span class="tally" data-tally="enquiries">0</span></button>
        <button type="button" class="admin-tab" role="tab" data-tab="applications" aria-selected="false">Applications<span class="tally" data-tally="applications">0</span></button>
        <button type="button" class="admin-tab" role="tab" data-tab="chat" aria-selected="false">Live chat<span class="tally" data-tally="chat">0</span></button>
        <button type="button" class="admin-tab" role="tab" data-tab="email" aria-selected="false">Email<span class="tally" data-tally="email">0</span></button>
        <button type="button" class="admin-tab" role="tab" data-tab="settings" aria-selected="false">Settings</button>
      </nav>

      <p class="admin-alert" id="admin-alert" role="alert" hidden></p>

      <div class="admin-body">
        <section class="admin-panel" data-panel="enquiries">
          <div class="admin-split">
            <ul class="admin-list" id="enquiry-list"><li class="admin-empty">Loading&hellip;</li></ul>
            <div class="admin-detail" id="enquiry-detail"><p class="admin-empty">Pick an enquiry to read it.</p></div>
          </div>
        </section>

        <section class="admin-panel" data-panel="applications" hidden>
          <div class="admin-split">
            <ul class="admin-list" id="application-list"><li class="admin-empty">Loading&hellip;</li></ul>
            <div class="admin-detail" id="application-detail"><p class="admin-empty">Pick an application to read it.</p></div>
          </div>
        </section>

        <section class="admin-panel" data-panel="chat" hidden>
          <div class="admin-split">
            <ul class="admin-list" id="chat-list"><li class="admin-empty">Loading&hellip;</li></ul>
            <div class="admin-detail" id="chat-detail"><p class="admin-empty">Pick a conversation to read and reply.</p></div>
          </div>
        </section>

        <section class="admin-panel" data-panel="email" hidden>
          <div class="admin-split">
            <ul class="admin-list" id="email-list"><li class="admin-empty">Loading&hellip;</li></ul>
            <div class="admin-detail" id="email-detail"><p class="admin-empty">Pick a thread to read it.</p></div>
          </div>
        </section>
        <section class="admin-panel" data-panel="settings" hidden>
          <div class="admin-settings" id="settings-panel"><p class="admin-empty">Loading&hellip;</p></div>
        </section>
      </div>
    </div>
  </main>`;

/* ==================================================================== export == */

const marketing = (file, opts) => ({ file, build: marketingPage, opts });

module.exports = [
  marketing('index.html', {
    title: `${BANK.name} | ${BANK.tagline}`,
    description: 'Personal and business banking from Rockfield National Bank: no-fee checking, 4.35% APY savings, cards, wires and a 24/7 fraud line. Member FDIC.',
    active: '', content: homeContent,
  }),
  marketing('personal.html', {
    title: `Personal banking | ${BANK.name}`,
    description: 'Checking, savings, certificates and cards from Rockfield National Bank.',
    active: 'personal', content: personalContent,
  }),
  marketing('business.html', {
    title: `Business banking | ${BANK.name}`,
    description: 'Operating accounts, payroll, merchant settlement and credit for businesses.',
    active: 'business', content: businessContent,
  }),
  marketing('rates.html', {
    title: `Rates and fees | ${BANK.name}`,
    description: 'Deposit rates and the full fee schedule at Rockfield National Bank.',
    active: 'rates', content: ratesContent,
  }),
  marketing('security-center.html', {
    title: `Security centre | ${BANK.name}`,
    description: 'How Rockfield protects your account, and what to do if something looks wrong.',
    active: 'security-center', content: securityCentreContent,
  }),
  marketing('open-account.html', {
    title: `Open an account | ${BANK.name}`,
    description: 'Start an application for a Rockfield checking, savings or business account.',
    active: '', content: openAccountContent,
  }),
  marketing('careers.html', {
    title: `Careers | ${BANK.name}`,
    description: 'Open roles at Rockfield National Bank across retail, payments, financial crime, compliance, lending and technology.',
    active: '', content: careersContent, extraScripts: ['/js/careers.js'],
  }),
  marketing('apply.html', {
    title: `Apply | ${BANK.name}`,
    description: 'Apply to Rockfield National Bank. One form, read by the people you would work with.',
    active: '', content: applyContent, extraScripts: ['/js/apply.js'],
  }),
  marketing('support.html', {
    title: `Support | ${BANK.name}`,
    description: 'Contact Rockfield National Bank. Client services six days a week and a 24/7 fraud line.',
    active: 'support', content: contactContent,
  }),
  marketing('legal.html', {
    title: `Legal and disclosures | ${BANK.name}`,
    description: 'Privacy notice, online banking agreement, Truth in Savings and funds availability.',
    active: '', content: legalContent,
  }),
  marketing('404.html', {
    title: `Page not found | ${BANK.name}`,
    description: 'Page not found.',
    active: '', content: notFoundContent,
  }),
  // The client services desk keeps the template's bare shell and its own
  // stylesheet: it is a staff tool, not a page of the bank's site.
  {
    file: 'admin.html',
    build: page,
    opts: {
      active: '', bodyClass: 'page-admin', bare: true, noindex: true,
      styles: ['/css/admin.css'],
      title: `Client services desk | ${BANK.name}`,
      description: 'Staff desk for website enquiries, applications, chat and mail.',
      content: deskContent,
      extraScripts: ['/js/supabase-lite.js', '/js/admin.js'],
    },
  },
];
