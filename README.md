# Hedgestone Finance

A Bitcoin-only investment platform: a public site that sells one thing,
a signed-in dashboard that follows each customer's Bitcoin from the day it was
bought to the day it matures, and a staff console that registers customers,
credits their cash balances and releases their withdrawals.

Everything runs on Node and Express with no framework and one runtime
dependency. Supabase holds the data in production; without it the same code
runs on JSON files, so the whole platform starts on a laptop with nothing
provisioned.

> **This is a demonstration.** Hedgestone Finance is fictional. Holdings are
> recorded in this application's own ledger: no order reaches an exchange, no
> Bitcoin is bought or held for anyone, and no real money moves through it.
> Offering it to real customers needs a licensed exchange or custody partner
> and the licences that go with taking money to invest.

```bash
npm install
npm run seed     # an administrator, a customer, three Bitcoin purchases
npm start        # http://localhost:3000
```

| | |
|---|---|
| Customer sign-in | `/signin` — `demo@hedgestonesfinance.com` / `Bedrock#Demo2026` |
| Staff console | `/console` — `admin@hedgestonesfinance.com` / `Hedgestone#Admin2026` |
| Client services desk | `/admin` — website enquiries, chat and mail (Supabase auth) |

The sign-in page carries both demonstration logins as buttons, so nothing needs
typing.

---

## The name

The platform's name is set in the console under **Settings → Platform name**
and nothing else needs changing: "Hedgestone Finance", "Hedge", anything. The
pages are built with the default and `public/js/bankname.js` swaps the set name
into every heading, sentence, tab title and attribute, and into the logo,
whose name is set in type beside the mark rather than drawn into the artwork.
Emails and texts are written with the default and go out under the set name
(`src/bank/alerts.js`), including the sender. A name we used to ship
("Hedgestone Global Bank"), stored by an old seed or left in an environment
variable, is treated as unset.

---

## What is in it

### For a customer

| Screen | What it does |
|---|---|
| `/dashboard` | The investment: what the Bitcoin is worth, what went in, growth so far; a chart of its value on every day since the first purchase against the amount invested, with each purchase marked and a table view; every purchase with its growth; time to maturity for each; cash to invest |
| `/invest` | Buy Bitcoin at the live price from $1 and choose a term (3, 6, 12 or 24 months by default); sell any part back to cash at any time; every purchase with its maturity date |
| `/transactions` | Search and filter every deposit, purchase, sale and withdrawal; CSV export |
| `/transfers` | Withdraw cash to a bank account in your own name: standard, same-day or international; one-time code and withdrawal PIN; receipts |
| `/recipients` | The bank accounts in your name that withdrawals are paid into |
| `/alerts` | Every notification raised, and control over which ones send |
| `/messages` | Secure messages with the team, inside the session |
| `/security` | Password, two-step verification, withdrawal PIN, security question, signed-in devices |
| `/activity` | The customer's own audit trail, with device and IP against each entry |
| `/profile` | Contact details, photo upload, documents on file |

A maturity date is the end of the term the customer chose. It is shown, counted
down and charted against; it does not lock the Bitcoin, and nothing happens on
the day.

### For staff, at `/console`

Register a customer — identity, address, employment, ID documents, photo and an
opening deposit — in one form. Then: credit or debit a cash balance with a
dated, described ledger entry; book a Bitcoin purchase or sale at an agreed
price, time and term, change a purchase's date or term, or reverse it; release
or return withdrawals with a reason the customer reads; verify withdrawal
accounts; reset passwords; suspend and restore access; reveal a full SSN
(recorded against your name); compose email alerts; answer secure messages;
read and export the activity log; and change the platform's name, the Bitcoin
terms on offer, withdrawal limits and fees, verification rules and the
announcement banner.

### Gone with Bitcoin-only

Cards, cheque deposits, bill pay, statements, claims, payments between
customers and every asset but Bitcoin were removed. Their old addresses
redirect (`src/site/retired.js`, mirrored in `vercel.json`). A customer who
bought another asset before keeps it, valued at the live price, and can sell
it; nothing else can be bought.

---

## Stack

- **Node 18+ and Express 4.** One runtime dependency.
- **Supabase (PostgREST) or JSON files.** `src/bank/db.js` decides at runtime;
  every collection has the same interface either way.
- **No build step for the application.** `npm run build` renders the static
  pages from template strings; the browser JavaScript is plain ES2020.
- **Sessions, not JWTs in the browser.** An opaque token in an httpOnly cookie,
  its SHA-256 digest in the database, plus a double-submit CSRF token.
- **scrypt** for passwords, PINs and security answers. **AES-256-GCM** for
  Social Security numbers and ID numbers.

---

## Project structure

```
src/
  bank/                     the investment platform
    constants.js            the platform, its one product, limits, fees, terms, alert types
    db.js                   collections over Supabase or JSON files
    ids.js                  account numbers, references, trace numbers
    security.js             scrypt, AES-256-GCM, masking, password policy
    auth.js                 sessions, CSRF, one-time codes, lockout
    users.js                creating a customer, and what may leave the server
    accounts.js             opening a customer's cash balance
    ledger.js               the only place a balance changes
    transfers.js            withdrawals: submit, verify, review, complete, reject
    invest.js               buying and selling Bitcoin, terms, maturity, positions
    markets.js              the live Bitcoin price and its daily history
    alerts.js               notification records and the branded emails
    audit.js                the activity log
    settings.js             operator overrides on top of the defaults
    seed.js                 first-run data: a demo investor with dated purchases
    site/                   the application's page shells and definitions
  controllers/bank/         HTTP handlers: auth, accounts, money, invest, profile, admin
  routes/bank.js            the /api/bank router
  site/                     the public site: layout, page content, retired paths
  controllers/, utils/      the website side: enquiries, chat, applications, mail

public/
  css/bank.css              the design system: shell, tables, forms, charts
  js/bank/                  core, signin, app, money, invest, profile, console
  js/                       main, chat, careers, apply, admin (the desk), bankname
  assets/bank/              the mark and generated artwork

supabase/migrations/        0001 to 0007, in order; supabase/setup.sql is all of them
scripts/seed-bank.js        npm run seed
test/bank.test.js           end-to-end API tests
test/bank-browser.test.js   the same flows through a real browser
```

---

## How the money works

Money is integer cents everywhere, and Bitcoin is held to eight decimal
places as an integer number of units. A balance only ever changes through
`src/bank/ledger.js`, inside a per-account lock, and every change writes a
transaction row. There is no code path that sets a balance directly, including
in the staff console, where "adjust a balance" posts a dated entry the customer
can see in their history.

Each customer has one cash balance. Deposits are credited to it by staff.
Buying Bitcoin debits it and records a purchase: the units, the price paid,
the date, and the term chosen (3, 6, 12 or 24 months by default, set under
Settings). The purchase date plus the term is the maturity date the dashboard
counts down to. Maturity is a target, not a lock: a customer can sell back to
cash at any time, and the dashboard counts a sale against the oldest purchase
first.

A withdrawal moves through these states:

```
submitted
  -> pending_verification   one-time code, and the withdrawal PIN if set
  -> pending_review         funds held; a person decides
  -> completed              the hold settles into a posting
   or rejected              the hold is released and the customer is told why
```

The hold goes on the moment the request is accepted, which is what stops the
same money being invested or withdrawn twice while it clears.

---

## Security

- Passwords, withdrawal PINs and security answers: scrypt (N=16384), compared
  in constant time. Five failed sign-ins lock the account for fifteen minutes.
- Sessions: 256-bit opaque tokens, httpOnly, SameSite=Lax, Secure behind
  HTTPS. The database holds only the digest, so a dump yields no usable
  session. Every device is listed to the customer and can be revoked.
- CSRF: a readable cookie echoed in a header on every state-changing request.
- Two-step verification on sign-in and on every withdrawal, by emailed code.
  Codes are hashed like passwords and retire when a new one is issued.
- SSNs and ID numbers are encrypted with AES-256-GCM under
  `BANK_ENCRYPTION_KEY`. Set it before the first customer is registered.
- A customer asking for another customer's records gets a 404, not a 403.
- Viewing a full SSN writes a warning-level activity row naming the member of
  staff who looked.

**Set `BANK_ENCRYPTION_KEY` in production.** Without it the application derives
a key from a fixed development string and logs a warning on every boot.

---

## API

Everything is under `/api/bank`. The router mounts ahead of the site's body
parser and rate limiter because uploads are larger and a dashboard screen is a
dozen calls.

```
GET    /config                  the platform's name and public settings
GET    /markets                 the Bitcoin price
GET    /markets/history         daily closes, for the growth chart

POST   /auth/login              password, then a code if two-step is on
POST   /auth/verify | /auth/resend
POST   /auth/logout
GET    /auth/session            who am I, unread counts, announcement
POST   /auth/forgot | /auth/reset | /auth/password

GET    /overview                everything the dashboard needs, in one call
GET    /invest                  holdings, positions, terms, maturity
POST   /invest/convert          buy Bitcoin from the cash balance
POST   /invest/sell             sell back to cash
GET    /accounts | /transactions | /transactions/:id | /transactions/export
GET    /transfers/options | /transfers | /transfers/:id
POST   /transfers | /transfers/:id/verify | /resend | /cancel     withdrawals
GET/POST/PATCH/DELETE  /beneficiaries[/:id]                       withdrawal accounts
GET/POST /alerts, /messages
GET    /me | PATCH /me | /me/documents | /me/security | /me/activity

/admin/*                        staff only
  GET  /overview | /customers | /customers/:id | /activity[/export] | /alerts
  POST /customers                                register a customer
  POST /customers/:id/accounts                   open a cash balance
  POST /accounts/:id/adjust                      post a ledger entry
  POST /transfers/:id/approve | /reject          the withdrawal queue
  GET  /investments | /customers/:id/investments
  POST /trades | PATCH /trades/:id | POST /trades/:id/reverse
                                                 book, re-date or reverse a purchase
  POST /alerts                                   compose and send
  GET  /settings | PUT /settings
```

The website side of the API (`/api/contact`, `/api/chat`, `/api/careers`,
`/api/applications`, `/api/emails`) is unchanged from the template and still
feeds the client services desk at `/admin`.

---

## Getting started

```bash
npm install
npm run seed          # skips itself if the platform already has users
npm start             # builds the pages, then serves on :3000
npm test              # API tests for the site and the platform
npm run test:browser  # the same flows in a real browser
```

Without Supabase, data is written under `./data/bank/*.json`. Delete that
directory to start over. Set `MARKET_DATA_FIXTURE=1` to work offline: prices
and history then come from a fixed series instead of the market data
providers.

### With Supabase

1. Run `supabase/setup.sql` in the SQL editor. It is every migration, 0001 to
   0007, and safe to run again; an existing project only needs the ones it has
   not had yet (0007 adds the term and maturity date to purchases).
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_ANON_KEY`
   for the chat widget and the desk).
3. Start the server. The first request seeds the platform if it is empty.

Every platform table has row level security on with no permissive policy: the
browser's anon key reaches none of it, and authorisation is decided in the
application, where the session lives.

### Email and text messages

Alerts are written to the database first and sent second. Without
`RESEND_API_KEY` they are stored, shown in the customer's notification centre,
and marked "not sent" in the console.

Texts go through Pingram on the same terms, and are delivered independently of
the email: an SMS outage never marks a delivered email failed. Money arriving
raises two alerts rather than one, the credit with the current balance, then
the available balance, because those are different numbers answering
different questions. [docs/RUNNING-THE-BANK.md](docs/RUNNING-THE-BANK.md) sets
both providers up and shows what the customer receives.

One-time codes behave the same way, with a guard: on a laptop with no mail
provider they come back in the API response so development can sign into
itself, and the sign-in page offers the demonstration logins. On anything that
looks deployed (`VERCEL`, `NODE_ENV=production`) both are off, because
`/auth/forgot` takes an address from anybody and `/auth/reset` takes the code
it returns. `BANK_SHOW_DEV_CODES=1` turns them back on deliberately for a
public demonstration.

---

## Configuration

| Variable | What it does |
|---|---|
| `BANK_ENCRYPTION_KEY` | **Set this.** AES-256-GCM key for SSNs and ID numbers |
| `BANK_ADMIN_EMAIL` / `BANK_ADMIN_PASSWORD` | The administrator's sign-in, applied on every boot |
| `BANK_ADMIN_RESET` | `1` resets that password on the next boot, for when it is lost |
| `BANK_DEMO_EMAIL` / `BANK_DEMO_PASSWORD` | The seeded demonstration customer |
| `BANK_NAME` | Sender name on emails. Leave it blank to use the name set under Settings |
| `BANK_ALERT_FROM` | Sender address for alert emails |
| `MARKET_DATA_FIXTURE` | `1` uses a fixed Bitcoin price series instead of live providers |
| `MARKET_CACHE_SECONDS` / `MARKET_HISTORY_CACHE_MINUTES` | How long a price and the history are reused |
| `PINGRAM_API_KEY` | Pingram secret key. Unset means no texts are delivered |
| `PINGRAM_SMS_FROM` | The sending number, in E.164 |
| `PINGRAM_DEFAULT_COUNTRY` | Country code assumed for a ten-digit number (`1`) |
| `PINGRAM_SMS_URL` | Override for Pingram's send endpoint |
| `PUBLIC_BASE_URL` | Absolute base for links inside emails (or `BANK_BASE_URL` / `APP_URL`) |
| `BANK_RATE_LIMIT_MAX` | Requests per minute per IP against `/api/bank` (300) |
| `BANK_LOGIN_RATE_LIMIT` | Sign-in attempts per five minutes (20) |
| `BANK_COOKIE_INSECURE` | `1` when serving over plain HTTP locally |
| `BANK_SHOW_DEV_CODES` | `1` exposes one-time codes and the demo logins on a deployment |
| `SUPABASE_*`, `RESEND_*`, `FORM_*` | As in `.env.example` |

Anything an operator should be able to change without a deploy (the platform
name, limits, fees, Bitcoin terms, verification rules, the announcement banner,
the session timeout) lives in the console under Settings instead.

---

## Images and the mark

Page artwork resolves at build time from `public/assets/bank/`. Drop in
`hedgestone1` … `hedgestone6` in any common format and the next build picks them
up in place of the generated placeholders; the build log says which were found.
Per-story images are named in `src/data/projects.json`.

The logo is the green H mark with the platform's name set beside it as text,
not artwork, so renaming the platform under Settings renames the logo too.
`npm run build:brand` cuts the mark out of `public/assets/img/hedgestonelogo.png`
and writes everything derived from it:

| Output | Built from |
|---|---|
| `assets/bank/logomark-{dark,light}.png` | the H alone, for light and dark backgrounds |
| `favicon.ico`, `favicon.png`, `apple-touch-icon.png`, `icon-512.png` | the H on a tile |
| `assets/bank/og-image.png` | the link card, 1200×630: the mark and "Invest in Bitcoin only." |

It needs Pillow and numpy, and it is not part of `npm run build`: the outputs
are committed. The link card carries no name, so it stays right after a rename.

---

## Deploying

`vercel.json` builds the static pages to `public/` and routes `/api/*` to
`api/[...path].js`, which is the same Express app. Vercel's filesystem is
read-only apart from `/tmp` and nothing there survives between invocations, so
production needs Supabase; the file backend is for local development. Paths of
removed pages (`/accounts`, `/cards`, `/statements`, `/personal` and so on)
redirect permanently to their nearest replacement.

`docs/DEPLOYMENT.md` covers Supabase, Resend and inbound mail step by step.
`docs/RUNNING-THE-BANK.md` covers the other half: registering customers,
crediting a cash balance, booking Bitcoin purchases, approving withdrawals, and
wiring up email and text alerts.
