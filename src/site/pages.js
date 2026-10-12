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
      : `<img class="rf-hero-mark" src="/assets/bank/logomark-light.png" alt="" aria-hidden="true" width="130" height="160" />`}
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
/* Small line icons for the home page, drawn to the same 24-unit grid. */
const svg = (d, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ui = {
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 18),
  card: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>'),
  piggy: svg('<path d="M19 11c0-3.3-3.1-6-7-6S5 7.7 5 11c0 1.6.7 3 1.9 4.1V19h3v-2h4v2h3v-3.6c.8-.6 1.4-1.4 1.8-2.4H21v-3h-1.4c-.1-.3-.3-.7-.6-1"/><path d="M15 9.5h.01M9 5.5 8 3"/>'),
  bars: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 12),
  send: svg('<path d="M7 17 17 7M8 7h9v9"/>', 18),
  request: svg('<path d="M12 4v12M6 10l6 6 6-6M5 20h14"/>', 18),
  topup: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>', 18),
  more: svg('<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>', 18),
  cup: svg('<path d="M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8zM16 9h2a2 2 0 0 1 0 4h-2M8 3v2M11 3v2"/>', 16),
  home: svg('<path d="M3 11 12 4l9 7M5 10v10h14V10"/>', 16),
  bag: svg('<path d="M6 7h12l-1 13H7L6 7zM9 7a3 3 0 0 1 6 0"/>', 16),
  bank: svg('<path d="M3 10 12 5l9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>', 16),
  nfc: svg('<path d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17"/>', 20),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 16),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>', 30),
  star: svg('<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9L12 3z"/>', 30),
  leaf: svg('<path d="M20 4c-9 0-15 4.5-15 11 0 2 .8 3.6 2 5 6.5 0 13-4.5 13-16zM5 20c2.5-5 6-8 10-10"/>', 30),
};
ui.shield30 = svg('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>', 30);

/* ===================================================================== home == */

const ceo = leadership[0];

const homeContent = `
  <section class="hs-band hs-band-hero">
    <img class="hs-band-photo" src="${images.homeMobile}" alt="" aria-hidden="true" fetchpriority="high" />
    <div class="wrap">
      <div class="hs-band-copy">
        <span class="rf-eyebrow hs-in" style="--d:0ms">Your bank, in your pocket</span>
        <h1 class="hs-in" style="--d:90ms">Bank from anywhere. Feel at home everywhere.</h1>
        <p class="hs-in" style="--d:180ms">Check balances, pay anyone, freeze a card and talk to a real person &mdash; from the street corner or the other side of the world.</p>
        <div class="hs-actions hs-in" style="--d:270ms">
          <a class="rf-btn lg hs-cta" href="/open-account">Open an account ${ui.arrow}</a>
          <a class="hs-textlink light" href="/digital">See the app</a>
        </div>
      </div>
    </div>
  </section>

  <section class="hs-trust-band">
    <div class="hs-trust">
      <div class="wrap">
        <p class="hs-trust-k">Trusted by families and businesses around the world</p>
        <div class="hs-trust-row">
          <div><span class="hs-ic">${ui.users}</span><span><b><span data-hs-count="2">2</span>M+</b><small>Global customers</small></span></div>
          <div><span class="hs-ic">${ui.shield30}</span><span><b>99.9%</b><small>Uptime</small></span></div>
          <div><span class="hs-ic">${ui.star}</span><span><b>4.8/5</b><small>App store rating</small></span></div>
          <div><span class="hs-ic">${ui.leaf}</span><span><b class="sm">A greener tomorrow</b><small>Supporting sustainable finance</small></span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="rf-section hs-split">
    <div class="wrap hs-split-grid">
      <figure class="hs-photo hs-photo-family">
        <img src="${images.hero}" alt="A family of four standing together outside, smiling" loading="lazy" width="1024" height="1024" />
        <figcaption class="hs-float-note"><i>${ui.piggy}</i><span><strong>Family goal: Summer trip</strong><span class="hs-bar"><span style="--w:72%"></span></span><small>$3,600 of $5,000 saved</small></span></figcaption>
      </figure>
      <div>
        <span class="rf-eyebrow">For the whole family</span>
        <h2>One home for everyone&rsquo;s money.</h2>
        <p class="section-lede">Joint accounts for the grown-ups, savings pots the kids can watch grow, and shared goals the whole family can chip in to &mdash; with alerts that keep everyone in the loop.</p>
        <ul class="hs-checks">
          <li>${tick}<span>Joint checking with a card for each of you</span></li>
          <li>${tick}<span>Savings goals with automatic round-ups</span></li>
          <li>${tick}<span>Send to family abroad in seconds, at a fee you see first</span></li>
        </ul>
        <p style="margin-top:26px"><a class="rf-btn" href="/personal">Explore personal banking</a></p>
      </div>
    </div>
  </section>


  <section class="rf-section alt">
    <div class="wrap">
      <span class="rf-eyebrow">Accounts</span>
      <h2>Open in ten minutes. Useful from the first day.</h2>
      <p class="section-lede">No monthly fee on Everyday Checking, no minimum on savings, and a rate that does not quietly expire after three months.</p>
      <div class="rf-grid cols-3">
        ${PRODUCTS.filter((p) => ['everyday_checking', 'high_yield_savings', 'hedgestone_signature_card'].includes(p.id)).map(productCard).join('')}
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

const digitalContent = `
  <section class="hs-home">
    <div class="hs-home-bg" aria-hidden="true"><span></span><span></span></div>
    <div class="wrap hs-home-grid">
      <div class="hs-home-copy">
        <span class="hs-kicker hs-in" style="--d:0ms">Digital banking &middot; app and online</span>
        <h1 class="hs-home-title hs-in" style="--d:80ms">More control.<br /><span class="hs-grad">More possibilities.</span></h1>
        <p class="hs-lede hs-in" style="--d:160ms">${BANK.name} gives you the tools to manage your money, save smarter, and reach your global goals &mdash; all in one place.</p>
        <div class="hs-actions hs-in" style="--d:240ms">
          <a class="rf-btn lg hs-cta" href="/open-account">Get started for free ${ui.arrow}</a>
          <a class="hs-textlink" href="/signin">Log in to online banking</a>
        </div>
        <ul class="hs-features">
          <li class="hs-in" style="--d:320ms"><span class="hs-ic">${ui.card}</span><h3>Easy Payments</h3><p>Send and receive money in seconds, globally.</p></li>
          <li class="hs-in" style="--d:390ms"><span class="hs-ic">${ui.piggy}</span><h3>Smart Savings</h3><p>Automate your savings and grow your wealth.</p></li>
          <li class="hs-in" style="--d:460ms"><span class="hs-ic">${ui.bars}</span><h3>Spending Insights</h3><p>See where your money goes and budget better.</p></li>
          <li class="hs-in" style="--d:530ms"><span class="hs-ic">${ui.shield}</span><h3>Bank-Grade Security</h3><p>Your data and funds are always protected.</p></li>
        </ul>
      </div>

      <div class="hs-home-visual" aria-hidden="true">
        <span class="hs-slab hs-slab-a"></span>
        <span class="hs-slab hs-slab-b"></span>
        <div class="hs-phone">
          <div class="hs-notch"></div>
          <div class="hs-screen">
            <div class="hs-screen-top">
              <div class="hs-status"><span>9:41</span><span class="hs-sig"><i></i><i></i><i></i></span></div>
              <div class="hs-app-brand"><img src="/assets/bank/logomark-light.png" alt="" width="17" height="21" /><span><strong>HEDGESTONE</strong><small>GLOBAL BANK</small></span></div>
              <div class="hs-balance">$<span data-hs-count="4250">4,250</span>.00</div>
              <div class="hs-delta"><span>${ui.up} +12%</span> vs. last month</div>
            </div>
            <div class="hs-sheet">
              <div class="hs-quick">
                <span><i>${ui.send}</i>Send</span><span><i>${ui.request}</i>Request</span><span><i>${ui.topup}</i>Top up</span><span><i>${ui.more}</i>More</span>
              </div>
              <div class="hs-tx-head"><strong>Recent transactions</strong><em>See all</em></div>
              <ul class="hs-tx">
                <li><i>${ui.cup}</i><span>Coffee Shop<small>Today</small></span><b>- $4.50</b></li>
                <li><i>${ui.home}</i><span>Salary Deposit<small>Yesterday</small></span><b class="in">+ $2,800.00</b></li>
                <li><i>${ui.bag}</i><span>Online Shopping<small>2 days ago</small></span><b>- $89.99</b></li>
                <li><i>${ui.send}</i><span>Transfer to Friend<small>3 days ago</small></span><b>- $120.00</b></li>
              </ul>
              <div class="hs-tabs"><span class="on">${ui.home}Home</span><span>${ui.card}Cards</span><span>${ui.bank}Wealth</span><span>${ui.more}More</span></div>
            </div>
          </div>
        </div>
        <div class="hs-card3d">
          <div class="hs-card-face">
            <div class="hs-card-brand"><img src="/assets/bank/logomark-light.png" alt="" width="20" height="25" /><span><strong>HEDGESTONE</strong><small>GLOBAL BANK</small></span></div>
            <span class="hs-chipset"></span>
            <span class="hs-nfc">${ui.nfc}</span>
            <span class="hs-card-type">DEBIT</span>
          </div>
        </div>
        <div class="hs-toast"><i>${ui.check}</i><span><strong>Payment received</strong><small>+ $1,250.00 &middot; London</small></span></div>
      </div>
    </div>

  </section>

  <section class="rf-section">
    <div class="wrap">
      <span class="rf-eyebrow">Everything in the app</span>
      <h2>Your whole bank, on the device in your hand.</h2>
      <p class="section-lede">The same accounts, the same protections and the same people behind them, whether you are on the phone, a laptop, or the other side of the world.</p>
      <div class="rf-grid cols-3">
        <div class="rf-card"><span class="hs-ic">${ui.send}</span><h3 class="hs-card-h">Send and request</h3><p>Pay anyone by email or phone number, split a bill, or send a wire with the fee shown before you confirm.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.card}</span><h3 class="hs-card-h">Card controls</h3><p>Freeze and unfreeze in a tap, set daily limits and switch international use on or off.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.bars}</span><h3 class="hs-card-h">Insights</h3><p>Thirty days of spending by category, upcoming bills, and money in and out for six months.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.request}</span><h3 class="hs-card-h">Mobile check deposit</h3><p>Photograph both sides and the funds availability is shown before you submit.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.shield}</span><h3 class="hs-card-h">Two-step security</h3><p>A one-time code on every sign-in and every outside payment, plus a transfer PIN of your own.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.check}</span><h3 class="hs-card-h">Instant alerts</h3><p>Sign-ins, payments and card activity, the moment they happen, by email and text.</p></div>
      </div>
      <p style="margin-top:28px"><a class="rf-btn lg hs-cta" href="/open-account">Get started for free ${ui.arrow}</a></p>
    </div>
  </section>
`;

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
          <p class="section-lede">We are a global bank of about 900 people. Nobody here is four layers from a customer: a payments analyst sees the transfer they released land, and whoever changes the ledger sits close enough to the branch to hear when it went wrong. We pay at market, promote from inside, and do not run a graduate scheme that keeps people away from real work for a year.</p>
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
  ${header({ eyebrow: 'Legal', title: 'Disclosures.', lede: 'The agreements and notices that govern an account at Hedgestone.' })}

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
    <img class="rf-hero-mark" src="/assets/bank/logomark-light.png" alt="" aria-hidden="true" width="130" height="160" />
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
        <span class="eyebrow">Hedgestone / Client services desk</span>
        <h1>Backend not connected.</h1>
        <div id="admin-missing"></div>
        <p class="admin-note">Set it in the deployment's environment variables and reload. Nothing needs rebuilding, but the change only reaches a running deployment after a redeploy.</p>
        <p class="admin-note"><a href="/api/health">/api/health</a> lists everything the server can see.</p>
        <a class="admin-back" href="/">Back to site</a>
      </div>
    </section>

    <section class="admin-gate" id="admin-login" hidden>
      <form class="admin-card" id="login-form" novalidate>
        <span class="eyebrow">Hedgestone / Client services desk</span>
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
          <img src="/assets/bank/logo-dark.png" alt="Hedgestone Global Bank" width="240" height="54" />
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
    description: 'Personal and business banking from Hedgestone Global Bank: no-fee checking, 4.35% APY savings, cards, wires and a 24/7 fraud line. Member FDIC.',
    active: '', content: homeContent,
  }),
  marketing('digital.html', {
    title: `Digital banking | ${BANK.name}`,
    description: 'The Hedgestone Global Bank app and online banking: payments, savings, insights and card controls in one place.',
    active: 'digital', content: digitalContent,
  }),
  marketing('personal.html', {
    title: `Personal banking | ${BANK.name}`,
    description: 'Checking, savings, certificates and cards from Hedgestone Global Bank.',
    active: 'personal', content: personalContent,
  }),
  marketing('business.html', {
    title: `Business banking | ${BANK.name}`,
    description: 'Operating accounts, payroll, merchant settlement and credit for businesses.',
    active: 'business', content: businessContent,
  }),
  marketing('rates.html', {
    title: `Rates and fees | ${BANK.name}`,
    description: 'Deposit rates and the full fee schedule at Hedgestone Global Bank.',
    active: 'rates', content: ratesContent,
  }),
  marketing('security-center.html', {
    title: `Security centre | ${BANK.name}`,
    description: 'How Hedgestone protects your account, and what to do if something looks wrong.',
    active: 'security-center', content: securityCentreContent,
  }),
  marketing('open-account.html', {
    title: `Open an account | ${BANK.name}`,
    description: 'Start an application for a Hedgestone checking, savings or business account.',
    active: '', content: openAccountContent,
  }),
  marketing('careers.html', {
    title: `Careers | ${BANK.name}`,
    description: 'Open roles at Hedgestone Global Bank across retail, payments, financial crime, compliance, lending and technology.',
    active: '', content: careersContent, extraScripts: ['/js/careers.js'],
  }),
  marketing('apply.html', {
    title: `Apply | ${BANK.name}`,
    description: 'Apply to Hedgestone Global Bank. One form, read by the people you would work with.',
    active: '', content: applyContent, extraScripts: ['/js/apply.js'],
  }),
  marketing('support.html', {
    title: `Support | ${BANK.name}`,
    description: 'Contact Hedgestone Global Bank. Client services six days a week and a 24/7 fraud line.',
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
