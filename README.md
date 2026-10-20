# Hedgestone Finance

A Bitcoin vault: a public site, a signed-in dashboard that follows each
investment from the day it went into the vault to the day it matures, and a
staff console that confirms what comes in and approves what goes out.

Everything runs on Node and Express with no framework and one runtime
dependency. Supabase holds the data in production; without it the same code
runs on JSON files, so the whole platform starts on a laptop with nothing
provisioned.

> **This is a demonstration.** Hedgestone Finance is fictional. Vaults are
> records in this application's own database: no Bitcoin is held for anyone,
> no transaction is made on any network, and no real money moves through it.
> Offering it to real customers needs a licensed custodian and OTC partner,
> and the licences that go with holding other people's Bitcoin.

```bash
npm install
npm run seed     # an administrator, a customer with a dated vault, a payment to confirm
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

## How the vault works

**In.** A customer adds to their vault two ways, both on `/receive`:

- **Cash, through the OTC partner.** They pay the partner from a bank in their
  name, quoting their customer number, and tell us the amount, the date they
  paid and the term they want. Staff check it with the partner and confirm it;
  it is booked as the Bitcoin that amount bought at Bitcoin's closing price on
  the day it was paid.
- **Bitcoin.** They send Bitcoin to their vault address and tell us how much,
  when and (if they have it) the transaction ID. Staff confirm it arrived; it is
  added at its value on that day.

**Held.** Every investment carries a term of **10 to 100 years**, in whole
years, and matures on its date plus its term. The dashboard shows both dates,
the years held and the time to go, and charts the vault's value every day
since the first investment against what went in.

**Out.** Only Bitcoin that has matured can be sent. The customer asks on
`/send` for an amount and an address of theirs, confirms with their PIN and an
emailed code, and staff make the transfer from the vault wallet and mark it
sent with its transaction ID. What leaves comes off the investments that
matured first.

**Dates.** Nothing can be dated before **1 January 2011**: Bitcoin began in
2009 but had no daily market price until mid-2010. Anything dated in the past,
whether a customer's payment or a staff booking, is priced at that day's close
(`markets.priceAt`, from Yahoo Finance, Blockchain.com, CryptoCompare or
Coinbase), never at today's price, so growth since 2014 is growth since 2014.
Moving it to another date reprices it: cash paid keeps its amount and buys what
it would have then; Bitcoin received keeps its units and is valued at the new
day.

**Set up by staff**, under Settings: the vault addresses (one a line; each
customer always sees the same one), the OTC partner's payment details, the
default term, and the fee to send. A customer can be given an address and
payment details of their own, from their record in the console. With neither,
Receive offers **Ask for payment details** / **Ask for a vault address**, and
staff answer it from Requests. Staff can suspend a customer, or delete one for
good (typing their email to confirm; the activity log keeps the record).

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
| `/dashboard` | The vault: what it is worth, what went in, growth so far, with the growth chart inside the same card (each investment marked, a table view); first investment and next maturity; the Bitcoin price; what is ready to send; each investment from the day it went in to the day it matures; open requests and recent movements |
| `/vault` | Everything in the vault with its price then, value now, growth and maturity |
| `/history` | Everything that moved in or out, filterable by kind and date; CSV export |
| `/receive` | The OTC partner's details and the customer's reference, the vault address, and forms to tell us about a payment or a transfer |
| `/send` | What is ready to send, a form to send it (PIN and emailed code), and when the rest matures |
| `/alerts` | Every notification raised, and control over which ones send |
| `/messages` | Secure messages with the team, inside the session |
| `/security` | Password, two-step verification, PIN for sending, security question, signed-in devices |
| `/activity` | The customer's own audit trail, with device and IP against each entry |
| `/profile` | Contact details, photo upload, documents on file |

### For staff, at `/console`

**Requests** is the queue: confirm a payment or a transfer (correcting the
amount, date or term to what actually arrived), mark a send as sent with its
transaction ID, or reject either with a reason the customer reads. Register a
customer, with anything they have already paid booked at that day's price. On a
customer's record, add to their vault directly (cash paid or Bitcoin received,
dated and with a term), move an investment to the date it really happened (it is
repriced), change its term, or reverse it. **Vaults** lists every customer's
Bitcoin at the live price. Also: reset passwords, suspend and restore access,
reveal a full SSN (recorded against your name), compose email alerts, answer
secure messages, read and export the activity log, and change the platform's
name, vault addresses, OTC details, default term and the announcement banner.

### What went with the vault

Cards, cheque deposits, bill pay, statements, claims, payments between
customers, cash balances, withdrawals to a bank, buying and selling, and every
asset but Bitcoin were removed. Their old addresses redirect
(`src/site/retired.js`, mirrored in `vercel.json`).

Customers who had cash or another asset have it converted to Bitcoin the next
time their vault is read, or when staff open **Vaults**: at the live price,
with what they originally paid carried over as invested, on the default term.
They are sent a notice, each conversion is in the activity log, and a
conversion cannot be reversed. Until it is converted it is not shown; if there
is no live price for it yet, the customer sees that a conversion is on its way
and staff see how many are waiting. Cash on hold for a withdrawal asked for
before the vault is left until staff release or return it, under **Requests**.

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
  bank/                     the vault
    constants.js            the platform, the vault's rules (terms, earliest date), fees, alert types
    db.js                   collections over Supabase or JSON files
    ids.js                  account numbers, references, trace numbers
    security.js             scrypt, AES-256-GCM, masking, password policy
    auth.js                 sessions, CSRF, one-time codes, lockout
    users.js                creating a customer, and what may leave the server
    vault.js                requests to receive and send, the vault address, the OTC partner
    invest.js               what is in a vault: booking in, sending out, dating, terms, conversions
    markets.js              the live Bitcoin price, its daily history since 2011, a price for any day
    accounts.js, ledger.js  cash balances from before the vault, kept so they convert cleanly
    transfers.js            withdrawals from before the vault, for staff to release or return
    alerts.js               notification records and the branded emails
    audit.js                the activity log
    settings.js             operator overrides on top of the defaults
    seed.js                 first-run data: a demo customer with a dated vault
    site/                   the application's page shells and definitions
  controllers/bank/         HTTP handlers: auth, vault, invest, profile, admin
  routes/bank.js            the /api/bank router
  site/                     the public site: layout, page content, retired paths
  controllers/, utils/      the website side: enquiries, chat, applications, mail

public/
  css/bank.css              the design system: shell, tables, forms, charts
  js/bank/                  core, signin, app (dashboard), vault, profile, console
  js/                       main, chat, careers, apply, admin (the desk), bankname
  assets/bank/              the mark and generated artwork

supabase/migrations/        0001 to 0008, in order; supabase/setup.sql is all of them
scripts/seed-bank.js        npm run seed
test/bank.test.js           end-to-end API tests
test/bank-browser.test.js   the same flows through a real browser
```

---

## How the money works

Cash is integer cents everywhere, and Bitcoin is held to eight decimal places
as an integer number of satoshis, so no figure is the result of a
floating-point rounding error. Each customer's vault changes one thing at a
time (a lock per customer).

A vault is a holding of Bitcoin and the trades that explain it: each one
coming in (`OTC-` cash paid, `RCV-` Bitcoin received, `CNV-` a conversion)
with its units, its price that day, what it cost and its term; each one going
out (`SND-`) with the address it went to. The dashboard's investments are
those trades as they stand now: what is left of each after anything sent, with
sends taken from what matured first.

A request moves through these states:

```
cash_in, btc_in   pending  -> completed (booked into the vault)   or rejected / cancelled
btc_out           pending_verification (PIN and emailed code)
                  -> pending (with staff)
                  -> completed (sent, with its transaction ID)    or rejected / cancelled
```

A request to send counts against what is ready to send from the moment it is
made, so the same Bitcoin cannot be asked for twice.

---

## Security

- Passwords, PINs for sending and security answers: scrypt (N=16384), compared
  in constant time. Five failed sign-ins lock the account for fifteen minutes.
- Sessions: 256-bit opaque tokens, httpOnly, SameSite=Lax, Secure behind
  HTTPS. The database holds only the digest, so a dump yields no usable
  session. Every device is listed to the customer and can be revoked.
- CSRF: a readable cookie echoed in a header on every state-changing request.
- Two-step verification on sign-in and on every send, by emailed code.
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

GET    /overview                who is signed in, open requests, alerts
GET    /invest                  the vault: worth, invested, investments, maturities, ready to send
GET    /vault                   vault address, OTC details, terms, ready to send, requests
POST   /vault/receive           "I have paid" (cash) or "I have sent" (bitcoin)
POST   /vault/send              ask to send matured Bitcoin to an address
POST   /vault/requests/:id/verify | /resend | /cancel
GET    /vault/history[/export]  everything that moved, filterable; CSV
GET/POST /alerts, /messages
GET    /me | PATCH /me | /me/documents | /me/security | /me/activity

/admin/*                        staff only
  GET  /overview | /customers | /customers/:id | /activity[/export] | /alerts
  POST /customers                                register a customer (and what they have paid)
  GET  /vault/requests?status=                   the requests queue
  POST /vault/requests/:id/confirm | /reject     book what arrived, record a send, or say no
  GET  /investments | /customers/:id/investments every vault, and one
  POST /trades | PATCH /trades/:id | POST /trades/:id/reverse
                                                 add to a vault by date, re-date (repriced), re-term, reverse
  POST /transfers/:id/approve | /reject          withdrawals from before the vault
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
   0008, and safe to run again; an existing project only needs the ones it has
   not had yet (0007 adds the term and maturity date to each investment, 0008
   the table of requests to receive and send).
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
the email: an SMS outage never marks a delivered email failed.
[docs/RUNNING-THE-BANK.md](docs/RUNNING-THE-BANK.md) sets
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
name, the vault addresses, the OTC partner, the default term, the fee to send,
verification rules, the announcement banner, the session timeout) lives in the
console under Settings instead.

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
removed pages (`/invest`, `/transfers`, `/accounts`, `/cards`, `/digital` and so
on) redirect permanently to their nearest replacement.

`docs/DEPLOYMENT.md` covers Supabase, Resend and inbound mail step by step.
`docs/RUNNING-THE-BANK.md` covers the other half: setting the vault up,
registering customers, confirming what comes in, sending what has matured, and
wiring up email and text alerts.
