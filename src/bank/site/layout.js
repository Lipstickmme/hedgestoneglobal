'use strict';

/**
 * Page shells for the bank, rendered at build time into static HTML.
 *
 * Three of them: the marketing pages anyone can see, the sign-in pages, and
 * the application shell behind them. They are built rather than assembled in
 * the browser so the first paint is the real page - a banking dashboard that
 * flashes an empty frame before the numbers arrive reads as broken.
 */

const { BANK, PRODUCTS } = require('../constants');

const YEAR = new Date().getFullYear();

/**
 * Absolute URL for the link card. Scrapers do not resolve a relative path
 * against the page they fetched, so `/assets/...` shows up blank everywhere.
 */
function socialImage() {
  return `${require('../../utils/config').baseUrl()}/assets/bank/og-image.png`;
}

/* ---------------------------------------------------------------- icons --- */

/*
 * The icon set.
 *
 * Drawn to sit with the logo and the serif rather than against them: flat-cut
 * ends and mitred corners, symmetrical about their own axis, and built from
 * the same vocabulary the mark uses - a pediment, a stylobate, a ruled line.
 * Engraved, like the artwork on a share certificate, rather than the rounded
 * geometric set that ships with every dashboard.
 *
 * Each icon is two layers. `body` is the structure, stroked at full weight;
 * `fine` is the detail - the flutes on a column, the wards of a key, the marks
 * on a dial - stroked lighter and, below about 18px, dropped entirely, because
 * a hairline at that size is a smudge that only makes the icon muddier. That
 * split is what gives them their density at the sizes where density reads, and
 * keeps them legible at the sizes where it does not.
 *
 * All on a 24 x 24 grid, and all stroked - none of them are filled, so one
 * definition serves a navy sidebar and a white page.
 */
const ICONS = {
  // A portico. The dashboard of a bank should look like one.
  home: {
    body: '<path d="M2.4 9.8 12 4.1l9.6 5.7"/><path d="M4.3 9.8v8.4M9.4 9.8v8.4M14.6 9.8v8.4M19.7 9.8v8.4"/><path d="M3.1 18.2h17.8"/><path d="M1.8 20.6h20.4"/>',
    fine: '<path d="M6.85 11v6M12 11v6M17.15 11v6"/><path d="M4.3 9.8h15.4"/>',
  },
  // A bound ledger, seen from the spine.
  accounts: {
    body: '<path d="M4.4 4.6h12.9a2.7 2.7 0 0 1 2.7 2.7v12.1H7.1a2.7 2.7 0 0 1-2.7-2.7z"/><path d="M4.4 16.7A2.7 2.7 0 0 1 7.1 14h12.9"/>',
    fine: '<path d="M8.2 8h8M8.2 11h5.4"/>',
  },
  // Figures moving across a ruled line.
  activity: {
    body: '<path d="M2.4 20.6h19.2"/><path d="M3.4 14.6 8 10l3.6 3.6L16.6 7l4 4"/>',
    fine: '<path d="M3.4 17.8h17.2"/>',
  },
  transfer: {
    body: '<path d="M3.4 8.8h14.2"/><path d="M13.9 5.1 17.6 8.8l-3.7 3.7"/><path d="M20.6 15.2H6.4"/><path d="M10.1 11.5 6.4 15.2l3.7 3.7"/>',
    fine: '',
  },
  people: {
    body: '<circle cx="9" cy="7.6" r="3.4"/><path d="M3 19.9a6 6 0 0 1 12 0"/><path d="M16.1 4.9a3.4 3.4 0 0 1 0 6.4"/><path d="M17 13.8a6 6 0 0 1 4 5.6"/>',
    fine: '',
  },
  // A bill with a torn foot.
  bill: {
    body: '<path d="M5.8 3h12.4v18l-2.5-1.7-2.5 1.7-2.6-1.7-2.4 1.7-2.4-1.6z"/>',
    fine: '<path d="M8.6 7.6h6.8M8.6 11h6.8M8.6 14.4h3.9"/>',
  },
  deposit: {
    body: '<path d="M12 3.2V14"/><path d="M7.5 9.5 12 14l4.5-4.5"/><path d="M3.3 16.6v4h17.4v-4"/>',
    fine: '<path d="M8.4 18.6h7.2"/>',
  },
  card: {
    body: '<path d="M2.4 4.8h19.2v14.4H2.4z"/><path d="M2.4 9.4h19.2"/>',
    fine: '<path d="M5.4 12.6h4.4v3.2H5.4z"/><path d="M13.6 15.8h5.2"/><path d="M5.4 14.2h4.4"/>',
  },
  statement: {
    body: '<path d="M5.8 3h8.4l4 4v14H5.8z"/><path d="M14.2 3v4h4"/>',
    fine: '<path d="M8.6 11.4h6.6M8.6 14.6h6.6M8.6 17.8h3.8"/>',
  },
  bell: {
    body: '<path d="M4.8 18.4c1.6-1.6 2.3-3.3 2.3-5.7v-1.8a4.9 4.9 0 0 1 9.8 0v1.8c0 2.4.7 4.1 2.3 5.7z"/><path d="M9.7 21.2h4.6"/>',
    fine: '<path d="M12 4.1V2.5"/><path d="M9.4 11.4a2.6 2.6 0 0 1 2.6-2.6"/>',
  },
  mail: {
    body: '<path d="M2.4 5h19.2v14H2.4z"/><path d="m2.4 5.9 9.6 6.7 9.6-6.7"/>',
    fine: '<path d="m2.4 18.2 6.6-5.4M21.6 18.2 15 12.8"/>',
  },
  // A heraldic shield: straight shoulders, a point at the foot.
  shield: {
    body: '<path d="M12 2.7 4.6 5.4v6.2c0 4.5 3 7.8 7.4 9.7 4.4-1.9 7.4-5.2 7.4-9.7V5.4z"/>',
    fine: '<path d="M12 5.6v12.2"/><path d="M6.9 6.4v5.2c0 3 1.9 5.4 5.1 7"/>',
  },
  user: {
    body: '<circle cx="12" cy="7.7" r="3.7"/><path d="M4.6 20.7a7.4 7.4 0 0 1 14.8 0"/>',
    fine: '',
  },
  console: {
    body: '<path d="M2.4 3.8h19.2v16.4H2.4z"/><path d="M2.4 8.4h19.2M8.8 8.4v11.8"/>',
    fine: '<path d="M11.4 11.4h7.4M11.4 14.2h7.4M11.4 17h4.4"/><path d="M5 5.7h1.4"/>',
  },
  logout: {
    body: '<path d="M10.4 4.4H4.8v15.2h5.6"/><path d="m15.4 7.9 4.1 4.1-4.1 4.1"/><path d="M19.5 12H9.4"/>',
    fine: '',
  },
  check: { body: '<path d="m4.4 12.3 4.9 4.9L19.6 6.7"/>', fine: '' },
  // A padlock, with the keyhole that says "locked".
  lock: {
    body: '<path d="M3.8 9.8h16.4v11.4H3.8z"/><path d="M7.6 9.8V7.1a4.4 4.4 0 0 1 8.8 0v2.7"/>',
    fine: '<circle cx="12" cy="14.4" r="1.5"/><path d="M12 15.9v2.6"/>',
  },
  clock: {
    body: '<circle cx="12" cy="12" r="9"/><path d="M12 6.3V12l4 2.4"/>',
    fine: '<path d="M12 3v1.6M21 12h-1.6M12 21v-1.6M3 12h1.6"/><path d="m17.7 6.3-1.1 1.1M17.7 17.7l-1.1-1.1M6.3 17.7l1.1-1.1M6.3 6.3l1.1 1.1"/>',
  },
  search: {
    body: '<circle cx="10.7" cy="10.7" r="6.9"/><path d="m15.6 15.6 5 5"/>',
    fine: '<path d="M7.6 10.7a3.1 3.1 0 0 1 3.1-3.1"/>',
  },
  chart: {
    body: '<path d="M2.4 20.6h19.2"/><path d="M5.6 20.6V11.8M10.5 20.6V5.4M15.4 20.6v-6.2M20.3 20.6V9"/>',
    fine: '<path d="M2.4 16.2h19.2M2.4 11.8h19.2"/>',
  },
  plus: { body: '<path d="M12 4.4v15.2M4.4 12h15.2"/>', fine: '' },
  // Three ruled lines. The one icon in the set that is a convention rather
  // than a drawing, because on a phone tab bar nothing else reads as "more".
  menu: { body: '<path d="M3.4 6.6h17.2M3.4 12h17.2M3.4 17.4h17.2"/>', fine: '' },
  building: {
    body: '<path d="M3.2 20.6V6.1L12 3.3v17.3"/><path d="M12 9.4h8.8v11.2"/><path d="M1.8 20.6h20.4"/>',
    fine: '<path d="M6.3 8.3v1.8M6.3 12.7v1.8M6.3 17.1v1.8M9 7.4v1.8M9 11.8v1.8M9 16.2v1.8M15.6 12.4v1.8M15.6 16.8v1.8M18.2 12.4v1.8M18.2 16.8v1.8"/>',
  },
};

/**
 * One icon, inline.
 *
 * Butt caps and mitred joins are the difference between this set and a rounded
 * one: a flat-cut end and a sharp corner read as engraved, which is what sits
 * with the serif.
 *
 * The fine layer is dropped below 18px. It is drawn at 60% of the body weight,
 * and 60% of a hairline at 15px is not a line - it is a grey blur that fills
 * the icon in and makes it harder to read, not richer.
 */
const icon = (name, size = 18) => {
  const art = ICONS[name] || { body: '', fine: '' };
  const detail = size >= 18 && art.fine;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="6" aria-hidden="true"><g stroke-width="1.6">${art.body}</g>${detail ? `<g stroke-width="0.95" opacity=".72">${art.fine}</g>` : ''}</svg>`;
};

/* ----------------------------------------------------------------- head --- */

function head({ title, description, noindex = false, styles = [], bodyClass }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />${noindex ? '\n  <meta name="robots" content="noindex, nofollow" />' : ''}
  <meta name="theme-color" content="#11213a" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${BANK.name}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${socialImage()}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${socialImage()}" />
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/favicon.png" type="image/png" sizes="512x512" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="stylesheet" href="/css/fonts.css" />
  <link rel="stylesheet" href="/css/bank.css" />
  ${styles.map((href) => `<link rel="stylesheet" href="${href}" />`).join('\n  ')}
</head>
<body class="${bodyClass}">`;
}

const scripts = (list) =>
  `${list.map((src) => `  <script src="${src}" defer></script>`).join('\n')}\n</body>\n</html>`;

/* --------------------------------------------------------- app sidebar --- */

const NAV = [
  {
    group: 'Banking',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'home', key: 'dashboard' },
      { href: '/accounts', label: 'Accounts', icon: 'accounts', key: 'accounts' },
      { href: '/transactions', label: 'Transactions', icon: 'activity', key: 'transactions' },
      { href: '/statements', label: 'Statements', icon: 'statement', key: 'statements' },
    ],
  },
  {
    group: 'Move money',
    items: [
      { href: '/transfers', label: 'Transfers', icon: 'transfer', key: 'transfers' },
      { href: '/recipients', label: 'Recipients', icon: 'people', key: 'recipients' },
      { href: '/bills', label: 'Bill pay', icon: 'bill', key: 'bills' },
      { href: '/deposit', label: 'Deposit a check', icon: 'deposit', key: 'deposit' },
    ],
  },
  {
    group: 'Account',
    items: [
      { href: '/cards', label: 'Cards', icon: 'card', key: 'cards' },
      { href: '/alerts', label: 'Alerts', icon: 'bell', key: 'alerts', pip: 'alerts' },
      { href: '/messages', label: 'Messages', icon: 'mail', key: 'messages', pip: 'messages' },
      { href: '/security', label: 'Security', icon: 'shield', key: 'security' },
      { href: '/profile', label: 'Profile', icon: 'user', key: 'profile' },
    ],
  },
];

function sidebar(active) {
  const groups = NAV.map((group) => `
        <div class="rf-nav-group">
          <h6>${group.group}</h6>
          ${group.items.map((item) => `<a href="${item.href}"${item.key === active ? ' class="is-active"' : ''}>${icon(item.icon)}<span>${item.label}</span>${item.pip ? `<em class="rf-pip rf-hide" data-pip="${item.pip}"></em>` : ''}</a>`).join('\n          ')}
        </div>`).join('');

  return `
    <aside class="rf-side" id="rf-side">
      <div class="rf-side-brand">
        <img class="rf-mark" src="/assets/bank/logomark-light.png" alt="" width="53" height="28" />
        <span>
          <strong>${BANK.shortName}</strong>
          <small>Online banking</small>
        </span>
      </div>
      <nav class="rf-nav">${groups}
        <div class="rf-nav-group rf-hide" data-admin-only>
          <h6>Staff</h6>
          <a href="/console">${icon('console')}<span>Admin console</span></a>
        </div>
      </nav>
      <div class="rf-side-foot">
        <div class="rf-side-user">
          <span class="rf-avatar" data-user-avatar>RF</span>
          <span>
            <strong data-user-name>&nbsp;</strong>
            <span data-user-number>&nbsp;</span>
          </span>
        </div>
        <button class="rf-btn ghost sm block" data-signout>${icon('logout', 15)} Sign out</button>
      </div>
    </aside>`;
}

/**
 * The bottom bar, on a phone.
 *
 * The sidebar is a desktop object: a long list you read down. A phone banking
 * app has four places you actually go and a way back to everything else, so
 * that is what this is - the four, plus a Menu that opens the same drawer the
 * burger does. It is hidden above the width where the sidebar is on screen.
 *
 * Menu takes the active mark for any screen the four do not cover, so the bar
 * always says where you are rather than going blank on the ninth page.
 */
const TABS = [
  { href: '/dashboard', label: 'Home', icon: 'home', key: 'dashboard' },
  { href: '/accounts', label: 'Accounts', icon: 'accounts', key: 'accounts' },
  { href: '/transfers', label: 'Transfer', icon: 'transfer', key: 'transfers' },
  { href: '/cards', label: 'Cards', icon: 'card', key: 'cards' },
];

function tabbar(active) {
  const onATab = TABS.some((tab) => tab.key === active);
  const links = TABS.map((tab) => `
        <a href="${tab.href}"${tab.key === active ? ' class="is-active" aria-current="page"' : ''}>${icon(tab.icon, 21)}<span>${tab.label}</span></a>`).join('');
  return `      <nav class="rf-tabbar" id="rf-tabbar" aria-label="Sections">${links}
        <button type="button" id="rf-tab-menu"${onATab ? '' : ' class="is-active"'} aria-controls="rf-side" aria-expanded="false">${icon('menu', 21)}<span>Menu</span></button>
      </nav>`;
}

/**
 * The application shell: sidebar, sticky header, content.
 * `actions` is raw HTML for the right-hand side of the header.
 */
function appPage({ title, description, heading, sub, active, content, extraScripts = [], actions = '', wide = false }) {
  return [
    head({ title, description, noindex: true, bodyClass: 'rf-app' }),
    `  <div class="rf-shell">`,
    sidebar(active),
    `    <div class="rf-main">
      <header class="rf-top">
        <button class="rf-burger" id="rf-burger" aria-label="Open menu"><span></span></button>
        <div>
          <h1>${heading}</h1>
          ${sub ? `<p class="rf-top-sub">${sub}</p>` : ''}
        </div>
        <div class="rf-top-actions">
          ${actions}
          <a class="rf-icon-btn" href="/alerts" aria-label="Alerts">${icon('bell')}<em class="rf-pip rf-hide" data-pip="alerts"></em></a>
          <a class="rf-icon-btn" href="/profile" aria-label="Profile"><span class="rf-avatar sm" data-user-avatar>RF</span></a>
        </div>
      </header>
      <main class="rf-content${wide ? '' : ''}" id="rf-content">
        <div class="rf-notice rf-hide" data-announcement></div>
${content}
      </main>
${tabbar(active)}
    </div>
  </div>
  <div class="rf-toasts" id="rf-toasts"></div>`,
    scripts(['/js/bank/core.js', ...extraScripts]),
  ].join('\n');
}

/** The sign-in shell: a panel on the right, the bank's case on the left. */
function authPage({ title, description, content, extraScripts = [] }) {
  return [
    head({ title, description, noindex: true, bodyClass: 'rf-auth' }),
    `  <div class="rf-auth-wrap">
    <section class="rf-auth-aside">
      <a class="brandline" href="/" aria-label="${BANK.name} home">
        <img class="rf-lockup" src="/assets/bank/logo-light.png" alt="${BANK.name}" width="240" height="143" />
      </a>
      <h2>Your money, held the way a bank should hold it.</h2>
      <p>${BANK.tagline} Deposits insured by the FDIC to the maximum permitted by law, and a real person on the phone when you need one.</p>
      <ul class="rf-auth-points">
        <li>${icon('check', 17)}<span>Two-step verification on every sign-in and every payment</span></li>
        <li>${icon('check', 17)}<span>Instant alerts the moment money moves</span></li>
        <li>${icon('check', 17)}<span>Zero liability on unauthorised card transactions</span></li>
        <li>${icon('check', 17)}<span>FDIC Certificate ${BANK.fdicCert} &middot; NMLS ${BANK.nmls}</span></li>
      </ul>
      <div class="rf-auth-foot">
        ${BANK.name} will never call, text or email to ask for your password or a one-time code.<br />
        Report anything suspicious on <span data-site="fraudPhone">our fraud line</span>.<br />
        &copy; ${YEAR} ${BANK.legalName}. Member FDIC. Equal Housing Lender.
      </div>
    </section>
    <section class="rf-auth-panel">
      <a class="rf-auth-brand" href="/" aria-label="${BANK.name} home">
        <img src="/assets/bank/logomark-light.png" alt="" width="53" height="28" />
        <span>
          <strong>${BANK.name}</strong>
          <small>Online banking</small>
        </span>
      </a>
${content}
    </section>
  </div>
  <div class="rf-toasts" id="rf-toasts"></div>`,
    scripts(['/js/bank/core.js', ...extraScripts]),
  ].join('\n');
}

/* -------------------------------------------------------- marketing bits --- */

function marketingNav(active = '') {
  const link = (href, label, key) =>
    `<a href="${href}"${key === active ? ' class="is-active" aria-current="page"' : ''}>${label}</a>`;
  return `
  <header class="rf-marketing-nav">
    <div class="wrap inner">
      <a class="brandline" href="/" aria-label="${BANK.name} home">
        <img class="rf-mark on-paper" src="/assets/bank/logomark-dark.png" alt="" width="87" height="46" />
        <span>
          <strong>${BANK.shortName}<span class="rf-full-name"> ${BANK.name.replace(`${BANK.shortName} `, '')}</span></strong>
          <small>Member FDIC</small>
        </span>
      </a>
      <nav>
        ${link('/personal', 'Personal', 'personal')}
        ${link('/business', 'Business', 'business')}
        ${link('/rates', 'Rates &amp; fees', 'rates')}
        ${link('/security-center', 'Security', 'security-center')}
        ${link('/support', 'Support', 'support')}
      </nav>
      <span class="spacer"></span>
      <div class="actions">
        <a class="rf-btn ghost sm" href="/open-account">Open an account</a>
        <a class="rf-btn sm" href="/signin">Sign in</a>
      </div>
    </div>
  </header>`;
}

function marketingFooter() {
  return `
  <footer class="rf-footer">
    <div class="wrap">
      <div class="cols">
        <div>
          <img class="rf-lockup" src="/assets/bank/logo-light.png" alt="${BANK.name}" width="190" height="113" style="margin-bottom:16px" />
          <p style="margin:0 0 12px;max-width:34ch">${BANK.tagline} Personal and business banking since ${BANK.established}.</p>
          <p style="margin:0;font-size:12.5px" data-site-row="address" hidden><span data-site="address"></span></p>
        </div>
        <div>
          <h5>Bank</h5>
          <a href="/personal">Personal banking</a>
          <a href="/business">Business banking</a>
          <a href="/rates">Rates and fees</a>
          <a href="/open-account">Open an account</a>
        </div>
        <div>
          <h5>Support</h5>
          <a href="/support">Help centre</a>
          <a href="/security-center">Security centre</a>
          <a href="#" data-site-row="phone" data-site="phone" hidden></a>
          <a href="mailto:${BANK.email}">${BANK.email}</a>
        </div>
        <div>
          <h5>Legal</h5>
          <a href="/legal#privacy">Privacy notice</a>
          <a href="/legal#terms">Online banking agreement</a>
          <a href="/legal#disclosures">Truth in Savings</a>
          <a href="/legal#accessibility">Accessibility</a>
        </div>
      </div>
      <div class="legal">
        <strong>${BANK.legalName}</strong> &middot; Member FDIC &middot; Equal Housing Lender &middot; FDIC Certificate ${BANK.fdicCert} &middot; NMLS ID ${BANK.nmls}<br />
        Deposits are insured by the Federal Deposit Insurance Corporation up to $250,000 per depositor, per insured bank, for each account ownership category.
        Annual Percentage Yields shown are accurate as of ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })} and may change after account opening. Fees may reduce earnings.
        Credit products are subject to credit approval.<br />
        This is a demonstration application. ${BANK.name} is a fictional institution: the routing number, account numbers and card numbers used here are synthetic and address no real financial institution.<br />
        &copy; ${YEAR} ${BANK.legalName}. All rights reserved.
      </div>
    </div>
  </footer>`;
}

/**
 * A public page: nav, content, footer, and the live chat widget the site
 * inherited from the template, which reaches the same client services desk.
 *
 * /js/main.js comes with every one of them because it is what submits the
 * contact form and what keeps the address and phone number on the page in step
 * with whatever the desk has set under Settings.
 */
function marketingPage({ title, description, active, content, extraScripts = [], bodyClass = 'rf-site' }) {
  const { chatWidget } = require('../../site/layout');
  return [
    head({ title, description, bodyClass }),
    marketingNav(active),
    content,
    marketingFooter(),
    chatWidget(),
    `  <div class="rf-toasts" id="rf-toasts"></div>`,
    scripts(['/js/main.js', '/js/supabase-lite.js', '/js/chat.js', ...extraScripts]),
  ].join('\n');
}

/* ------------------------------------------------------------- dates --- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MONTH_OPTIONS = MONTHS
  .map((name, index) => `<option value="${String(index + 1).padStart(2, '0')}">${name}</option>`)
  .join('');

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) =>
  `<option value="${String(i + 1).padStart(2, '0')}">${i + 1}</option>`).join('');

/**
 * A date, entered by picking its parts rather than hunting a calendar.
 *
 * A native date input opens a month grid, which is the right instrument for
 * "a week on Thursday" and the wrong one for a date of birth: nobody pages
 * back four hundred and twenty months to 1961. Three selects instead, with
 * the year running backwards from the present, so the year is one scroll
 * rather than a expedition. On a phone each one opens the system's own
 * wheel; on a desktop it is a list you can type the first digits into.
 *
 * `from` and `to` are offsets in years from whatever year it is when the page
 * is opened - not when it was built - because the list is filled in the
 * browser. `order` puts the likeliest end first: 'desc' for anything in the
 * past, 'asc' for anything ahead.
 *
 * The three selects carry no name. The hidden input does, and it holds the
 * ISO date the server has always been sent, so nothing downstream of the form
 * knows this changed.
 */
function dateField({ id, name, label, from = -110, to = 0, order = 'desc', hint = '', wrapClass = 'rf-field' }) {
  // rf-field-date marks it out for the one thing three controls need that one
  // does not: the full width of a narrow column.
  return `<div class="${wrapClass} rf-field-date">
                        <span class="rf-label" id="${id}-label">${label}</span>
                        <div class="rf-dateparts" role="group" aria-labelledby="${id}-label" data-dateparts data-from="${from}" data-to="${to}" data-order="${order}">
                          <select class="rf-select" data-part="month" aria-label="${label}: month"><option value="">Month</option>${MONTH_OPTIONS}</select>
                          <select class="rf-select" data-part="day" aria-label="${label}: day"><option value="">Day</option>${DAY_OPTIONS}</select>
                          <select class="rf-select" data-part="year" aria-label="${label}: year"><option value="">Year</option></select>
                          <input type="hidden" id="${id}" name="${name}" data-part="value" />
                        </div>${hint ? `
                        <p class="hint">${hint}</p>` : ''}
                      </div>`;
}

/* ----------------------------------------------------------- small parts --- */

/** A product card, shared by the home page and the product pages. */
function productCard(product) {
  const headline = product.apy != null && product.apy > 0
    ? `<div class="rf-rate rate">${product.apy.toFixed(2)}%<small> APY</small></div>`
    : product.apr
      ? `<div class="rf-rate rate">${product.apr.toFixed(2)}%<small> APR var.</small></div>`
      : '<div class="rf-rate rate">$0<small> monthly fee</small></div>';
  return `
      <article class="rf-product">
        ${headline}
        <h3>${product.name}</h3>
        <p>${product.blurb}</p>
        <ul>
          ${product.features.map((f) => `<li>${icon('check', 15)}<span>${f}</span></li>`).join('\n          ')}
        </ul>
        <a class="rf-btn ghost" href="/open-account?product=${product.id}">Open ${product.name} <span aria-hidden="true">&rsaquo;</span></a>
      </article>`;
}

const productGrid = (ids) =>
  `<div class="rf-grid cols-3">${(ids ? PRODUCTS.filter((p) => ids.includes(p.id)) : PRODUCTS).map(productCard).join('')}</div>`;

module.exports = { head, scripts, appPage, authPage, tabbar, dateField, marketingPage, marketingNav, marketingFooter, sidebar, icon, productCard, productGrid, NAV, BANK };
