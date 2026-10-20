'use strict';

/**
 * The public site: everything a visitor can read without signing in.
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

const site = require('../data/site.json');
const images = require('./images');
const { page } = require('./layout');
const { marketingPage, icon, brand, RISK } = require('../bank/site/layout');
const { BANK, VAULT } = require('../bank/constants');


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
              <option>Opening a vault</option>
              <option>My vault</option>
              <option>Sending or receiving Bitcoin</option>
              <option>Something looks wrong</option>
              <option>Careers</option>
              <option>Something else</option>
            </select><div class="err" data-err="service"></div>
          </div>
        </div>
        <div class="rf-field field"><label for="${id}-message">How can we help?</label><textarea class="rf-textarea" id="${id}-message" name="message" placeholder="Tell us what you need. Never include a password or a one-time code." required></textarea><div class="err" data-err="message"></div></div>
        <div class="honeypot" aria-hidden="true" style="position:absolute;left:-9999px"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
        <div class="form-status rf-small" data-form-status role="status" aria-live="polite"></div>
        <button type="submit" class="rf-btn block" data-submit>Send message</button>
        <p class="rf-small rf-muted" style="margin:12px 0 0">Someone from our team replies the same business day. For anything urgent, call <strong data-site="phone">our support team</strong>.</p>
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
ui.coin = svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 7.5h3.6a2 2 0 0 1 0 4H9.5zM9.5 11.5h4.1a2.1 2.1 0 0 1 0 4.2H9.5zM9.5 7.5v8.2M11 6v1.5M13 6v1.5M11 15.7v1.5M13 15.7v1.5"/>', 22);
ui.clock = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 22);
ui.device = svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>', 30);
ui.shield30 = svg('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>', 30);

/* ===================================================================== home == */

/*
 * The landing page is the dashboard page it grew out of: the vault, shown as
 * the customer will see it, then how it works and how to reach us.
 */
const homeContent = `
  <section class="hs-home">
    <div class="hs-home-bg" aria-hidden="true"><span></span><span></span></div>
    <div class="wrap hs-home-grid">
      <div class="hs-home-copy">
        <span class="hs-kicker hs-in" style="--d:0ms">The ${BANK.name} vault</span>
        <h1 class="hs-home-title hs-in" style="--d:80ms">Secure your Bitcoin<br /><span class="hs-grad">for the decades ahead.</span></h1>
        <p class="hs-lede hs-in" style="--d:160ms">Place Bitcoin in a <mark class="hs-hl">vault</mark> on a term you set, from ten years to a hundred. Every investment is priced on the day it went in, followed every day after, and released to you when it matures.</p>
        <div class="hs-actions hs-in" style="--d:240ms">
          <a class="rf-btn lg hs-cta" href="/open-account">Open your vault ${ui.arrow}</a>
          <a class="hs-textlink" href="/signin">Sign in to your vault</a>
        </div>
        <ul class="hs-features">
          <li class="hs-in" style="--d:320ms"><span class="hs-ic">${ui.bars}</span><h3>Growth since day one</h3><p>Value against what went in, every day.</p></li>
          <li class="hs-in" style="--d:390ms"><span class="hs-ic">${ui.clock}</span><h3>Your maturity date</h3><p>Ten to a hundred years, set by you.</p></li>
          <li class="hs-in" style="--d:460ms"><span class="hs-ic">${ui.coin}</span><h3>Priced on the day</h3><p>Each investment at that day&rsquo;s price.</p></li>
          <li class="hs-in" style="--d:530ms"><span class="hs-ic">${ui.shield}</span><h3>Verified release</h3><p>A code and a person on every send.</p></li>
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
              <div class="hs-app-brand"><img src="/assets/bank/logomark-light.png" alt="" width="17" height="21" /><span data-brand-name><b>${BANK.name.split(/\s+/)[0]}</b>${BANK.name.split(/\s+/).length > 1 ? `<small>${BANK.name.split(/\s+/).slice(1).join(' ')}</small>` : ''}</span></div>
              <div class="hs-balance">$<span data-hs-count="24318">24,318</span>.40</div>
              <div class="hs-delta"><span>${ui.up} +62.8%</span> since day one</div>
            </div>
            <div class="hs-sheet">
              <svg class="hs-mini-chart" viewBox="0 0 240 64" preserveAspectRatio="none"><path d="M0 56 L24 52 L48 54 L72 44 L96 46 L120 36 L144 38 L168 26 L192 30 L216 18 L240 12" fill="none" stroke="#0e8a62" stroke-width="2.5" stroke-linejoin="round"/><path d="M0 56 L60 56 L60 42 L150 42 L150 34 L240 34" fill="none" stroke="#7a5cd6" stroke-width="2" stroke-dasharray="5 4"/></svg>
              <div class="hs-quick">
                <span><i>${ui.request}</i>Receive</span><span><i>${ui.send}</i>Send</span><span><i>${ui.coin}</i>Vault</span><span><i>${ui.more}</i>More</span>
              </div>
              <div class="hs-tx-head"><strong>Your investments</strong><em>See all</em></div>
              <ul class="hs-tx">
                <li><i>${ui.coin}</i><span>0.0456 BTC &middot; 10 years<small>Matures Jul 2036</small></span><b class="in">+5.3%</b></li>
                <li><i>${ui.coin}</i><span>0.0745 BTC &middot; 15 years<small>Matures Aug 2040</small></span><b class="in">+57.1%</b></li>
                <li><i>${ui.coin}</i><span>0.0612 BTC &middot; 10 years<small>Matured &middot; ready to send</small></span><b class="in">+412%</b></li>
              </ul>
              <div class="hs-tabs"><span class="on">${ui.home}Home</span><span>${ui.coin}Vault</span><span>${ui.request}Receive</span><span>${ui.send}Send</span></div>
            </div>
          </div>
        </div>
        <div class="hs-toast"><i>${ui.check}</i><span><strong>Added to your vault</strong><small>0.0158 BTC &middot; 20-year term</small></span></div>
      </div>
    </div>
    <div class="wrap"><p class="rf-small rf-muted" style="margin:18px 0 0">Illustration with example figures. Your dashboard shows your own vault at the live price.</p></div>
  </section>

  <section class="hs-trust-band">
    <div class="hs-trust">
      <div class="wrap">
        <p class="hs-trust-k">Built for the long term: <mark class="hs-hl">a vault for your Bitcoin</mark></p>
        <div class="hs-trust-row">
          <div><span class="hs-ic">${ui.clock}</span><span><b class="sm">${VAULT.termYears.min} to ${VAULT.termYears.max} years</b><small>Your term, your maturity date</small></span></div>
          <div><span class="hs-ic">${ui.coin}</span><span><b class="sm">Priced on the day</b><small>Cash or Bitcoin, valued as it went in</small></span></div>
          <div><span class="hs-ic">${ui.send}</span><span><b class="sm">Released at maturity</b><small>Sent to a wallet of yours</small></span></div>
          <div><span class="hs-ic">${ui.shield30}</span><span><b class="sm">Checked by people</b><small>Every movement confirmed by our team</small></span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="rf-section">
    <div class="wrap">
      <span class="rf-eyebrow">Everything on your dashboard</span>
      <h2>Your vault, on the device in your hand.</h2>
      <p class="section-lede">There is no app to download. Sign in from the browser on your phone, tablet or laptop and you get the same dashboard, the same protections and the same people behind them, wherever you are.</p>
      <div class="rf-grid cols-3">
        <div class="rf-card"><span class="hs-ic">${ui.bars}</span><h3 class="hs-card-h">Value since day one</h3><p>A chart from your first investment to today, with each one marked and what went in drawn alongside.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.coin}</span><h3 class="hs-card-h">Growth, investment by investment</h3><p>What each one cost, Bitcoin&rsquo;s price that day, what it is worth now and how much it has grown or fallen.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.clock}</span><h3 class="hs-card-h">The day it went in, the day it matures</h3><p>Both dates side by side for every investment, with the years held and the time still to run.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.request}</span><h3 class="hs-card-h">Add to it two ways</h3><p>Pay cash through our OTC partner, or send Bitcoin you already own to your vault address.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.send}</span><h3 class="hs-card-h">Send when it matures</h3><p>Once an investment reaches its date, send it to a wallet of yours. A code and our team confirm every send.</p></div>
        <div class="rf-card"><span class="hs-ic">${ui.check}</span><h3 class="hs-card-h">Instant alerts</h3><p>Sign-ins, Bitcoin added and Bitcoin sent, the moment they happen, by email and text.</p></div>
      </div>
    </div>
  </section>

  <section class="rf-section alt">
    <div class="wrap">
      <span class="rf-eyebrow">How it works</span>
      <h2>Three steps, decades apart.</h2>
      <div class="rf-grid cols-3 hs-steps">
        <article class="rf-card"><div class="rf-card-body"><span class="hs-step-n">1</span><h3 class="hs-card-h">Open your vault</h3><p class="rf-muted">Tell us about yourself and someone from our team verifies your identity and opens your vault, usually the same business day.</p></div></article>
        <article class="rf-card"><div class="rf-card-body"><span class="hs-step-n">2</span><h3 class="hs-card-h">Add Bitcoin, set the term</h3><p class="rf-muted">Pay cash through our OTC partner or send Bitcoin you hold, and choose how long it stays: ${VAULT.termYears.min} to ${VAULT.termYears.max} years. It is priced on the day it goes in.</p></div></article>
        <article class="rf-card"><div class="rf-card-body"><span class="hs-step-n">3</span><h3 class="hs-card-h">Follow it to maturity</h3><p class="rf-muted">Your dashboard charts its value every day and counts down to its maturity date. From that day it can be sent to a wallet of yours.</p></div></article>
      </div>
      <div class="hs-actions" style="margin-top:26px"><a class="rf-btn lg hs-cta" href="/open-account">Open your vault ${ui.arrow}</a><a class="hs-textlink" href="/bitcoin">How the vault works</a></div>
    </div>
  </section>

  <section class="rf-section">
    <div class="wrap" style="max-width:860px">
      <div class="rf-notice warn hs-risk">
        <div><strong>Before you invest</strong>${RISK} A maturity date marks the end of the term you chose; it is not a promise of any value on that day.</div>
      </div>
    </div>
  </section>

  <section class="rf-section alt" id="contact">
    <div class="wrap">
      <div class="rf-grid side" style="gap:44px;align-items:start">
        <div>
          <span class="rf-eyebrow">Talk to us</span>
          <h2>A person, not a menu.</h2>
          <dl class="rf-dl" style="max-width:460px">
            <dt data-site-row="phone" hidden>Phone</dt><dd data-site-row="phone" data-site="phone" hidden></dd>
            <dt>Email</dt><dd><a href="mailto:${site.email}" data-site="email">${site.email}</a></dd>
            <dt data-site-row="hours" hidden>Hours</dt><dd data-site-row="hours" data-site="hours" hidden></dd>
            <dt data-site-row="fraudPhone" hidden>Urgent, any hour</dt><dd data-site-row="fraudPhone" data-site="fraudPhone" hidden></dd>
            <dt data-site-row="address" hidden>Post</dt><dd data-site-row="address" data-site="address" hidden></dd>
          </dl>
          <div class="rf-notice warn" style="margin-top:22px">
            <div><strong>We will never ask for a code.</strong>Not by phone, text or email. Signed-in customers can use secure messages for anything about their vault.</div>
          </div>
        </div>
        ${enquiryForm('home-contact-form', { heading: 'Send us a message', note: 'Someone from our team replies the same business day.' })}
      </div>
    </div>
  </section>`;

/* ================================================================== bitcoin == */

const TERM_CHOICES = [10, 20, 30, 50, 100].filter((y) => y >= VAULT.termYears.min && y <= VAULT.termYears.max);
const THIS_YEAR = new Date().getFullYear();

const bitcoinContent = `
  ${header({
    eyebrow: 'How the vault works',
    title: 'Bitcoin, held for the long term.',
    lede: 'How Bitcoin goes into your vault, how it is priced, and how it comes back to you when it matures.',
    image: images.bitcoinHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <div class="rf-grid side" style="gap:44px;align-items:start">
        <div>
          <span class="rf-eyebrow">Two ways in</span>
          <h2>Cash or Bitcoin, priced on the day it arrives.</h2>
          <p class="section-lede">However it comes in, each investment is booked at Bitcoin&rsquo;s price on the day it was made, so the growth you see is the growth since that day.</p>
          <ul class="hs-checks">
            <li>${tick}<span><strong>Pay cash through our OTC partner.</strong> Pay from a bank in your name, quoting your reference. When the partner confirms, the payment buys Bitcoin at that day&rsquo;s price.</span></li>
            <li>${tick}<span><strong>Send Bitcoin you already hold.</strong> Send it to your vault address. When it arrives it is added at its value that day.</span></li>
            <li>${tick}<span><strong>Held to the satoshi.</strong> Bitcoin divides into a hundred million parts, so every amount is exact.</span></li>
          </ul>
        </div>
        <div class="rf-card hs-live-card">
          <div class="rf-card-body">
            <span class="rf-eyebrow">Bitcoin now</span>
            <div class="hs-live-card-v" data-btc-price>&mdash;</div>
            <div class="rf-small rf-muted"><span data-btc-change></span> <span data-btc-source></span></div>
            <a class="rf-btn block rf-mt" href="/open-account">Open your vault</a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="rf-section alt">
    <div class="wrap">
      <span class="rf-eyebrow">Choose your term</span>
      <h2>How long should it stay in the vault?</h2>
      <p class="section-lede">Every investment carries a term of ${VAULT.termYears.min} to ${VAULT.termYears.max} years, in whole years, chosen when it goes in. It matures on that date, and from then it can be sent to a wallet of yours.</p>
      <div class="rf-grid cols-${Math.min(5, TERM_CHOICES.length)} hs-terms-grid">
        ${TERM_CHOICES.map((y) => `<div class="rf-card rf-stat"><div class="k">Term</div><div class="v">${y} years</div><div class="d">In today, matures in ${THIS_YEAR + y}</div></div>`).join('')}
      </div>
    </div>
  </section>

  <section class="rf-section">
    <div class="wrap">
      <span class="rf-eyebrow">Your dashboard</span>
      <h2>Everything about your vault, on the first screen.</h2>
      <div class="rf-grid cols-2" style="gap:24px">
        <div class="rf-feature"><span class="ic">${icon('chart', 18)}</span><div><h3>Value since day one</h3><p>A chart of what your vault has been worth on every day since your first investment, against what went in.</p></div></div>
        <div class="rf-feature"><span class="ic">${icon('bitcoin', 18)}</span><div><h3>Growth so far</h3><p>For the whole vault and for each investment, in dollars and per cent, at today&rsquo;s live price.</p></div></div>
        <div class="rf-feature"><span class="ic">${icon('hourglass', 18)}</span><div><h3>Time to maturity</h3><p>The day each investment went in, the day it matures, and how far through its term it is.</p></div></div>
        <div class="rf-feature"><span class="ic">${icon('send', 18)}</span><div><h3>Send when it matures</h3><p>Matured Bitcoin can be sent to a wallet of yours: confirmed by a code, checked by our team, then sent.</p></div></div>
      </div>
      <p style="margin-top:28px"><a class="rf-btn lg hs-cta" href="/open-account">Open your vault ${ui.arrow}</a></p>
    </div>
  </section>

  <section class="rf-section alt">
    <div class="wrap" style="max-width:860px">
      <div class="rf-notice warn hs-risk">
        <div><strong>Know the risk</strong>${RISK} A maturity date marks the end of your chosen term. Bitcoin can be sent out of your vault only after it, and it does not promise a value on that day.</div>
      </div>
    </div>
  </section>`;

/* ===================================================================== fees == */

const FEES = [
  ['Opening a vault', 'None'],
  ['Monthly or annual fee', 'None'],
  ['Holding Bitcoin in your vault', 'None'],
  ['Sending Bitcoin you already hold into your vault', 'None from us; the Bitcoin network fee is paid by the sender'],
  ['Paying cash through our OTC partner', 'The partner&rsquo;s rate, which they quote before you pay'],
  ['Choosing your term', 'None'],
  ['Sending matured Bitcoin to your wallet', 'The Bitcoin network fee, plus our fee if any, shown on the Send page before you confirm'],
];

const ratesContent = `
  ${header({
    eyebrow: 'Fees',
    title: 'What a vault costs.',
    lede: 'Everything we charge, on one page. Most of it is nothing.',
    image: images.ratesHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <span class="rf-eyebrow">Every fee we charge</span>
      <h2>No fee to open. No fee to hold.</h2>
      <div class="rf-card">
        <div class="rf-table-wrap">
          <table class="rf-table">
            <thead><tr><th>Service</th><th class="num">Fee</th></tr></thead>
            <tbody>${FEES.map(([label, value]) => `<tr><td>${label}</td><td class="num">${value}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>

      <h2 style="margin-top:48px">The limits.</h2>
      <div class="rf-grid cols-3">
        <div class="rf-card rf-stat"><div class="k">Smallest cash payment</div><div class="v">$1.00</div><div class="d">Bitcoin is held to the satoshi</div></div>
        <div class="rf-card rf-stat"><div class="k">Terms</div><div class="v">${VAULT.termYears.min} to ${VAULT.termYears.max}</div><div class="d">years, chosen as it goes in</div></div>
        <div class="rf-card rf-stat"><div class="k">Sending out</div><div class="v">At maturity</div><div class="d">Only Bitcoin that has matured can be sent</div></div>
      </div>

      <p class="rf-disclosure" style="margin-top:24px">
        Fees are accurate as of ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })} and may change; we will tell you before they do. ${RISK}
      </p>
    </div>
  </section>`;

/* ========================================================== security centre == */

const securityCentreContent = `
  ${header({
    eyebrow: 'Security centre',
    title: 'How we protect your vault, and how you can.',
    lede: 'What runs on our side, what to switch on for yours, and what to do the moment something looks wrong.',
    image: images.securityHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <div class="rf-notice bad">
        <div><strong>We will never ask for a one-time code.</strong>
        Not by phone, not by text, not by email. If anyone asks for a code or your password, hang up and call <span data-site="fraudPhone">our security line</span>.</div>
      </div>

      <h2 style="margin-top:34px">What runs whether you think about it or not.</h2>
      <div class="rf-grid cols-2" style="gap:24px">
        <div class="rf-feature"><span class="ic">${icon('shield', 18)}</span><div><h3>Every send checked</h3><p>Bitcoin leaves a vault only after our team has checked the request against what has matured.</p></div></div>
        <div class="rf-feature"><span class="ic">${icon('lock', 18)}</span><div><h3>Encrypted at rest</h3><p>Social Security numbers and identity documents are encrypted with keys the application cannot print.</p></div></div>
        <div class="rf-feature"><span class="ic">${icon('activity', 18)}</span><div><h3>Every action logged</h3><p>Who did what, from which device and address. You can read your own history under Activity.</p></div></div>
        <div class="rf-feature"><span class="ic">${icon('user', 18)}</span><div><h3>Sessions you control</h3><p>See every signed-in device and sign any of them out, from anywhere.</p></div></div>
      </div>

      <h2 style="margin-top:48px">Four things worth ten minutes.</h2>
      <div class="rf-card"><div class="rf-card-body">
        <ol style="margin:0;padding-left:20px;line-height:2.1">
          <li>Turn on two-step verification, and leave it on.</li>
          <li>Set a PIN for sending Bitcoin that you use nowhere else.</li>
          <li>Only send Bitcoin to the vault address on your Receive page, and check it every time.</li>
          <li>Check your own wallet address twice before you ask us to send to it.</li>
        </ol>
      </div></div>

      <h2 style="margin-top:48px">If something is wrong, call first.</h2>
      <div class="rf-grid cols-3">
        <div class="rf-card rf-stat"><div class="k">Security line, 24/7</div><div class="v" style="font-size:20px" data-site="fraudPhone">Open around the clock</div><div class="d">Anything urgent about your vault</div></div>
        <div class="rf-card rf-stat"><div class="k">General support</div><div class="v" style="font-size:20px" data-site="phone">Six days a week</div><div class="d" data-site="hours">${site.hours}</div></div>
        <div class="rf-card rf-stat"><div class="k">Report a phishing email</div><div class="v" style="font-size:16px">${BANK.securityEmail}</div><div class="d">Forward it; do not click anything in it</div></div>
      </div>
    </div>
  </section>`;

/* ============================================================= open account == */

const openAccountContent = `
  ${header({
    eyebrow: 'Open your vault',
    title: 'Open your Bitcoin vault.',
    lede: 'Tell us a little about yourself and someone from our team comes back to you the same business day to open your vault.',
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
            <dt>Address</dt><dd>Where you live now</dd>
            <dt>To add to it</dt><dd>Cash through our OTC partner, or Bitcoin you already hold</dd>
          </dl>
          <div class="rf-notice" style="margin-top:22px">
            <div><strong>Why this is a message and not a form full of secrets.</strong>
            Vaults at ${BANK.name} are opened by our team, who verify your identity properly. Never send a Social Security number or a password through a web form.</div>
          </div>
          <p style="margin-top:22px"><a class="rf-btn ghost" href="/rates">See the fees first</a></p>
        </div>
        ${enquiryForm('open-account-form', { heading: 'Tell us about yourself', note: 'We come back to you the same business day.' })}
      </div>
    </div>
  </section>`;

/* =================================================================== careers == */

const careersContent = `
  ${header({
    eyebrow: 'Careers',
    title: 'Work somewhere the ledger has to balance.',
    lede: 'Operations, risk, compliance, client support and technology. On site, hybrid and remote.',
    image: images.careersHeader,
  })}

  <section class="rf-section">
    <div class="wrap">
      <div class="rf-grid side" style="gap:44px;align-items:start">
        <div>
          <span class="rf-eyebrow">Life at ${BANK.name}</span>
          <h2>Small enough to know what you changed.</h2>
          <p class="section-lede">We do one thing &mdash; keep Bitcoin safe for the long term &mdash; and nobody here is four layers from a customer. Whoever changes the ledger sits close enough to support to hear when it went wrong. We pay at market, promote from inside, and do not run a graduate scheme that keeps people away from real work for a year.</p>
        </div>
        <div class="rf-card"><div class="rf-card-body">
          <h3 style="font-family:var(--rf-display);margin:0 0 10px">What we offer</h3>
          <ul style="list-style:none;padding:0;margin:0;display:grid;gap:9px">
            ${['Health, dental and vision from day one', '6% 401(k) match, vested immediately', '20 days leave and a week at the holidays', 'Tuition support for finance qualifications', 'Hybrid by default, remote where the role allows']
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
                <option>New to finance</option>
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
    lede: 'Support six days a week, with a security line that never closes.',
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
            <dt data-site-row="fraudPhone" hidden>Urgent, any hour</dt><dd data-site-row="fraudPhone" data-site="fraudPhone" hidden></dd>
            <dt data-site-row="internationalPhone" hidden>International</dt><dd data-site-row="internationalPhone" data-site="internationalPhone" hidden></dd>
            <dt data-site-row="address" hidden>Post</dt><dd data-site-row="address" data-site="address" hidden></dd>
          </dl>

          <h3 style="font-family:var(--rf-display);margin:30px 0 10px">Already have a vault?</h3>
          <p class="rf-muted rf-small">Once you are signed in, secure messages are the safe place for anything about your vault. They sit inside your session, so personal details are fine to include.</p>
          <p><a class="rf-btn ghost" href="/signin">Sign in to your vault</a></p>

          <div class="rf-notice warn" style="margin-top:22px">
            <div><strong>Never send a secret here.</strong>No passwords and no one-time codes. We will never ask for them.</div>
          </div>
        </div>
        ${enquiryForm('contact-form', { heading: 'Send us a message', note: 'We reply the same business day.' })}
      </div>
    </div>
  </section>`;

/* ===================================================================== legal == */

const legalContent = `
  ${header({ eyebrow: 'Legal', title: 'Terms, privacy and risk.', lede: `The notices that govern a vault at ${BANK.name}.` })}

  <section class="rf-section">
    <div class="wrap" style="max-width:820px">
      <article class="rf-card"><div class="rf-card-body">
        <h2 id="privacy" style="font-family:var(--rf-display);margin-top:0;font-size:21px">Privacy notice</h2>
        <p class="rf-muted">${BANK.legalName} collects the information needed to open and run your vault: your name, address, date of birth, Social Security number, identification documents, what goes into and out of your vault, and the devices you use to reach us. We share it only with the service providers who help us run the platform, and with regulators and law enforcement where the law requires it. We do not sell it.</p>
        <p class="rf-muted">You may limit marketing at any time under Alerts once you are signed in, or by calling <span data-site="phone">our support team</span>.</p>

        <h2 id="terms" style="font-family:var(--rf-display);font-size:21px">Terms of use</h2>
        <p class="rf-muted">Access to your vault is personal to you. Keep your password and one-time codes to yourself, tell us immediately if you think someone else has them, and review your activity. We may hold, delay or decline a request to send Bitcoin where we reasonably suspect fraud, where it would breach a limit, or where a manual check is required. Where we decline one, the Bitcoin stays in your vault and you are told why.</p>
        <p class="rf-muted">Everything added to your vault is booked at Bitcoin&rsquo;s price on the day the payment was made or the Bitcoin arrived. Each investment carries the term you chose, from ${VAULT.termYears.min} to ${VAULT.termYears.max} years, and a maturity date; it can be sent out of your vault only once that date has passed.</p>

        <h2 id="risk" style="font-family:var(--rf-display);font-size:21px">Risk warning</h2>
        <p class="rf-muted">${RISK} The growth shown on your dashboard is calculated from the market price and is not a forecast. Bitcoin in your vault is not a deposit and is not covered by any deposit insurance scheme.</p>

        <h2 id="accessibility" style="font-family:var(--rf-display);font-size:21px">Accessibility</h2>
        <p class="rf-muted">We aim to meet WCAG 2.2 AA across the site and your vault. If any part of it is difficult to use, tell us on <span data-site="phone">our support line</span> or <a href="mailto:${site.email}" data-site="email">${site.email}</a> and we will help you complete what you were doing and fix the underlying problem.</p>

        <h2 id="demo" style="font-family:var(--rf-display);font-size:21px">About this application</h2>
        <p class="rf-muted">${BANK.legalName} is a fictional company. This site is a demonstration of a Bitcoin vault application: the vaults, balances and customer records used throughout are synthetic, and no real money or Bitcoin moves through it.</p>
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
        <span class="eyebrow">${BANK.name} / Client services desk</span>
        <h1>Backend not connected.</h1>
        <div id="admin-missing"></div>
        <p class="admin-note">Set it in the deployment's environment variables and reload. Nothing needs rebuilding, but the change only reaches a running deployment after a redeploy.</p>
        <p class="admin-note"><a href="/api/health">/api/health</a> lists everything the server can see.</p>
        <a class="admin-back" href="/">Back to site</a>
      </div>
    </section>

    <section class="admin-gate" id="admin-login" hidden>
      <form class="admin-card" id="login-form" novalidate>
        <span class="eyebrow">${BANK.name} / Client services desk</span>
        <h1>Staff sign in.</h1>
        <p class="admin-note" id="login-note">Website enquiries, live chat and the shared mailbox. Customer accounts are in the <a href="/console">staff console</a>.</p>
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
          ${brand()}
          <span>Client services desk</span>
        </a>
        <div class="admin-bar-end">
          <a class="admin-signout" href="/console" style="text-decoration:none">Staff console</a>
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
    title: `${BANK.name} | A vault for your Bitcoin`,
    description: `${BANK.name} keeps your Bitcoin in a vault on a term you choose, from ten years to a hundred: priced on the day it goes in, followed every day, and released to you when it matures.`,
    active: '', content: homeContent,
  }),
  marketing('bitcoin.html', {
    title: `How the vault works | ${BANK.name}`,
    description: 'How Bitcoin goes into your vault, how it is priced, the terms you can choose, and how it comes back to you when it matures.',
    active: 'bitcoin', content: bitcoinContent,
  }),
  marketing('rates.html', {
    title: `Fees | ${BANK.name}`,
    description: `Every fee ${BANK.name} charges for a Bitcoin vault.`,
    active: 'rates', content: ratesContent,
  }),
  marketing('security-center.html', {
    title: `Security centre | ${BANK.name}`,
    description: `How ${BANK.name} protects your vault, and what to do if something looks wrong.`,
    active: 'security-center', content: securityCentreContent,
  }),
  marketing('open-account.html', {
    title: `Open your vault | ${BANK.name}`,
    description: `Open a Bitcoin vault with ${BANK.name}.`,
    active: '', content: openAccountContent,
  }),
  marketing('careers.html', {
    title: `Careers | ${BANK.name}`,
    description: `Open roles at ${BANK.name} across operations, risk, compliance, client support and technology.`,
    active: '', content: careersContent, extraScripts: ['/js/careers.js'],
  }),
  marketing('apply.html', {
    title: `Apply | ${BANK.name}`,
    description: `Apply to ${BANK.name}. One form, read by the people you would work with.`,
    active: '', content: applyContent, extraScripts: ['/js/apply.js'],
  }),
  marketing('support.html', {
    title: `Support | ${BANK.name}`,
    description: `Contact ${BANK.name}. Support six days a week and a security line that never closes.`,
    active: 'support', content: contactContent,
  }),
  marketing('legal.html', {
    title: `Terms, privacy and risk | ${BANK.name}`,
    description: 'Privacy notice, terms of use, risk warning and accessibility.',
    active: '', content: legalContent,
  }),
  marketing('404.html', {
    title: `Page not found | ${BANK.name}`,
    description: 'Page not found.',
    active: '', content: notFoundContent,
  }),
  // The client services desk keeps the template's bare shell and its own
  // stylesheet: it is a staff tool, not a page of the public site.
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
