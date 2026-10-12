# Rockfield National Bank

A complete retail banking application: a public bank site, online banking for
customers, and a staff console that registers customers, opens accounts, moves
balances and releases payments.

Everything runs on Node and Express with no framework and one runtime
dependency. Supabase holds the data in production; without it the same code
runs on JSON files, so the whole bank starts on a laptop with nothing
provisioned.

> **This is a demonstration.** Rockfield National Bank is fictional. The
> routing number sits in a prefix the Federal Reserve has not assigned, account
> numbers and card numbers are generated in published test ranges, and no real
> money can move through any of it.

```bash
npm install
npm run seed     # an administrator, a customer, six months of history
npm start        # http://localhost:3000
```

| | |
|---|---|
| Customer sign-in | `/signin` — `demo@rockfieldglobalfinance.com` / `Bedrock#Demo2026` |
| Staff console | `/console` — `admin@rockfieldglobalfinance.com` / `Rockfield#Admin2026` |
| Client services desk | `/admin` — website enquiries, chat and mail (Supabase auth) |

The sign-in page carries both demonstration logins as buttons, so nothing needs
typing.

---

## What is in it

### For a customer

| Screen | What it does |
|---|---|
| `/dashboard` | Balances, available funds, six months of money in and out, 30-day spending by category, pending items, upcoming bills |
| `/accounts` | Every account, with routing and wire details to hand to an employer |
| `/transactions` | Search and filter by account, category, method, direction, amount and date; CSV export |
| `/statements` | Twelve monthly statements per account, printable, with opening and closing balances |
| `/transfers` | Between own accounts, ACH, domestic and international wire, instant send and bill pay; scheduled and recurring; one-time code and transfer PIN; receipts with confirmation, ACH trace and IMAD |
| `/recipients` | Saved beneficiaries with ABA checksum validation and SWIFT for international |
| `/bills` | Payees, due days and autopay |
| `/deposit` | Mobile check deposit: photograph both sides, Regulation CC hold applied |
| `/cards` | Freeze, unfreeze, set daily limits, report lost or stolen with same-day replacement |
| `/alerts` | Every notification raised, and fine-grained control over which ones send |
| `/messages` | Secure messages with the bank, inside the session |
| `/security` | Password, two-step verification, transfer PIN, security question, signed-in devices |
| `/activity` | The customer's own audit trail, with device and IP against each entry |
| `/profile` | Contact details, photo upload, documents on file |

### For staff, at `/console`

Register a customer end to end — identity, address, employment, income, ID
documents, photo, the accounts they leave with, opening balances and a card —
in one form. Then: adjust a balance with a dated, described, categorised ledger
entry; open or freeze accounts; issue and freeze cards; release or return
transfers with a reason the customer reads; accept or return check deposits;
verify recipients; resolve claims with a provisional or final credit; reset
passwords; suspend and restore access; reveal a full SSN (recorded against your
name); compose email alerts to one customer or all of them; answer secure
messages; read and export the activity log; and change the bank's own limits,
fees, verification rules and announcement banner.

### The banking parts that are usually missing

Routing numbers that pass the ABA checksum. Account numbers with a Luhn check
digit. Card numbers in published test BINs, Luhn-valid, never shown in full.
ACH trace numbers, Fedwire IMAD and OMAD references, SWIFT codes. Pending
entries that hold funds and settle separately from posted ones. Available
balance as distinct from balance. Overdraft cover and credit limits. Statement
periods computed from the entries rather than stored. Regulation CC holds on
mobile deposits. Daily limits per payment type, measured against the value
date. Fee schedules that apply at post time. Reversals as contra-entries, never
deletions.

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
  Social Security numbers, ID numbers and card numbers.

---

## Project structure

```
src/
  bank/                     the banking application
    constants.js            the institution, products, limits, fees, alert types
    db.js                   collections over Supabase or JSON files
    ids.js                  account, card, ABA, Luhn, ACH trace, IMAD
    security.js             scrypt, AES-256-GCM, masking, password policy
    auth.js                 sessions, CSRF, one-time codes, lockout
    users.js                creating a customer, and what may leave the server
    accounts.js             opening accounts, issuing cards
    ledger.js               the only place a balance changes
    transfers.js            submit, verify, review, complete, reject, schedule
    alerts.js               notification records and the branded emails
    audit.js                the activity log
    settings.js             operator overrides on top of the defaults
    seed.js                 first-run data with six months of history
    site/                   the application's page shells and definitions
  controllers/bank/         HTTP handlers: auth, accounts, money, profile, admin
  routes/bank.js            the /api/bank router
  site/                     the public bank site: layout and page content
  controllers/, utils/      the website side: enquiries, chat, applications, mail

public/
  css/bank.css              the design system: shell, tables, forms, cards
  js/bank/                  core, signin, app, money, profile, console
  js/                       main, chat, careers, apply, admin (the desk)
  assets/bank/              generated placeholder artwork

supabase/migrations/0003_bank.sql    the banking schema
scripts/seed-bank.js                 npm run seed
test/bank.test.js                    end-to-end API tests
test/bank-browser.test.js            the same flows through a real browser
```

---

## How the money works

Money is integer cents everywhere. A balance only ever changes through
`src/bank/ledger.js`, inside a per-account lock, and every change writes a
transaction row. There is no code path that sets a balance directly — including
in the staff console, where "adjust a balance" posts a dated entry the customer
can see on their statement.

A transfer moves through the states a real one does:

```
submitted
  -> pending_verification   one-time code, and the transfer PIN if set
  -> pending_review         funds held; a person decides
  -> completed              the hold settles into a posting
   or rejected              the hold is released and the customer is told why
```

Internal transfers skip the middle: both legs are on our own books, so both
post at once. Everything else puts a hold on the money the moment it is
accepted, which is what stops it being spent twice while it clears.

---

## Security

- Passwords, transfer PINs and security answers: scrypt (N=16384), compared in
  constant time. Five failed sign-ins lock the account for fifteen minutes.
- Sessions: 256-bit opaque tokens, httpOnly, SameSite=Lax, Secure behind
  HTTPS. The database holds only the digest, so a dump yields no usable
  session. Every device is listed to the customer and can be revoked.
- CSRF: a readable cookie echoed in a header on every state-changing request.
- Two-step verification on sign-in and on every outside transfer, by emailed
  code. Codes are hashed like passwords and retire when a new one is issued.
- SSNs, ID numbers and card numbers are encrypted with AES-256-GCM under
  `BANK_ENCRYPTION_KEY`. Set it before the first customer is registered.
- A customer asking for another customer's account gets a 404, not a 403.
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
POST   /auth/login              password, then a code if two-step is on
POST   /auth/verify             the code
POST   /auth/logout
GET    /auth/session            who am I, unread counts, announcement
POST   /auth/forgot | /auth/reset | /auth/password

GET    /overview                everything the dashboard needs, in one call
GET    /accounts | /accounts/:id | /accounts/:id/statements[/:period]
GET    /transactions | /transactions/:id | /transactions/export
GET    /cards            POST /cards/:id          freeze, limits, report lost
GET    /transfers/options | /transfers | /transfers/:id
POST   /transfers | /transfers/:id/verify | /cancel | /resend
GET/POST/PATCH/DELETE  /beneficiaries[/:id], /payees[/:id]
GET/POST /deposits, /disputes, /alerts, /messages
GET    /me | PATCH /me | /me/documents | /me/security | /me/activity

/admin/*                        staff only
  GET  /overview | /customers | /customers/:id | /activity[/export] | /alerts
  POST /customers                                register a customer
  POST /customers/:id/accounts                   open an account
  POST /accounts/:id/adjust                      post a ledger entry
  POST /transfers/:id/approve | /reject          the review queue
  POST /deposits/:id/review | /disputes/:id/resolve
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
npm run seed          # skips itself if the bank already has users
npm start             # builds the pages, then serves on :3000
npm test              # API tests for the site and the bank
npm run test:browser  # the same flows in a real browser
```

Without Supabase, data is written under `./data/bank/*.json`. Delete that
directory to start over.

### With Supabase

1. Apply `supabase/migrations/0001_init.sql`, `0002_email.sql` and
   `0003_bank.sql` in the SQL editor.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_ANON_KEY`
   for the chat widget and the desk).
3. Start the server. The first request seeds the bank if it is empty.

Every banking table has row level security on with no permissive policy: the
browser's anon key reaches none of it, and authorisation is decided in the
application, where the session lives.

### Email and text messages

Alerts are written to the database first and sent second. Without
`RESEND_API_KEY` they are stored, shown in the customer's notification centre,
and marked "not sent" in the console.

Texts go through Pingram on the same terms, and are delivered independently of
the email: an SMS outage never marks a delivered email failed. Money arriving
raises two alerts rather than one — the credit with the current balance, then
the available balance — because those are different numbers answering
different questions. [docs/RUNNING-THE-BANK.md](docs/RUNNING-THE-BANK.md) sets
both providers up and shows what the customer receives.

One-time codes behave the same way, with a guard: on a laptop with no mail
provider they come back in the API response so development can sign into
itself, and the sign-in page offers the demonstration logins. On anything that
looks deployed — `VERCEL`, `NODE_ENV=production` — both are off, because
`/auth/forgot` takes an address from anybody and `/auth/reset` takes the code
it returns. `BANK_SHOW_DEV_CODES=1` turns them back on deliberately for a
public demonstration.

---

## Configuration

| Variable | What it does |
|---|---|
| `BANK_ENCRYPTION_KEY` | **Set this.** AES-256-GCM key for SSNs, ID and card numbers |
| `BANK_ADMIN_EMAIL` / `BANK_ADMIN_PASSWORD` | The administrator's sign-in, applied on every boot |
| `BANK_ADMIN_RESET` | `1` resets that password on the next boot, for when it is lost |
| `BANK_DEMO_EMAIL` / `BANK_DEMO_PASSWORD` | The seeded demonstration customer |
| `BANK_ALERT_FROM` | Sender for alert emails |
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

Anything an operator should be able to change without a deploy — limits, fees,
the routing number, verification rules, the announcement banner, the session
timeout — lives in the console under Settings instead.

---

## Images and the mark

Page artwork resolves at build time from `public/assets/bank/`. Drop in
`rockfield1` … `rockfield6` in any common format and the next build picks them
up in place of the generated placeholders; the build log says which were found.
Per-story images are named in `src/data/projects.json`.

The logo lives once, as geometry, in `src/bank/site/logo.js` — a boulder with a
banking hall in front of it, stroked in `currentColor` so the same shapes serve
a navy sidebar and a white nav without a second file. `npm run build:brand`
writes everything derived from it:

| Output | Built from |
|---|---|
| `assets/bank/mark-{dark,light}.svg` | the line work alone |
| `assets/bank/wordmark-{dark,light}.svg` | mark over ROCKFIELD / BANK |
| `favicon.ico` (16, 32, 48) | a filled reduction — at 16px, the hall alone |
| `favicon.png`, `apple-touch-icon.png` | the line work on a navy tile |
| `assets/bank/og-image.png` | the link card, 1200×630 |

It needs `playwright-core` to rasterise, and it is not part of `npm run build` —
the outputs are committed, because they change about as often as the bank
changes its name. Edit the geometry, run it again, and every size follows.

---

## Deploying

`vercel.json` builds the static pages to `public/` and routes `/api/*` to
`api/[...path].js`, which is the same Express app. Vercel's filesystem is
read-only apart from `/tmp` and nothing there survives between invocations, so
production needs Supabase — the file backend is for local development.

`docs/DEPLOYMENT.md` covers Supabase, Resend and inbound mail step by step.
`docs/RUNNING-THE-BANK.md` covers the other half: registering customers,
crediting an account, moving money, and wiring up email and text alerts.
