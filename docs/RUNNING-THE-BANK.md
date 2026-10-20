# Running the platform

Day-to-day operation of Hedgestone Finance from the staff console, and how to
wire up the two things that reach a customer outside the site: email and text
messages.

Everything here happens at **`/console`**. You get there by signing in at
`/signin` with an account whose role is `admin` — there is no separate console
login. See [DEPLOYMENT.md](DEPLOYMENT.md#two-sign-ins-and-which-is-which) if
that sentence is surprising.

The platform is a **Bitcoin vault**. Each customer has a vault of investments,
each with the day it went in, its price that day, and a term of 10 to 100
years that sets when it matures. Bitcoin comes in as cash paid to the OTC
partner or as Bitcoin sent to the vault address, and goes out only once it has
matured, sent to an address of the customer's. You confirm every one. There
are no cash balances, cards, cheques, bill payments, statements or payments
between customers.

---

## Part 1 — the console

### The short version

| To do this | Go here |
| --- | --- |
| Set the vault addresses, the OTC partner, the default term and the fee to send | **Settings** |
| Confirm a payment or a transfer a customer told us about, or mark a send as sent | **Requests** |
| Give one customer their own vault address or payment details, or answer their request for them | **Customers** → open one → **Set details for this customer**, or **Requests** → **Give details** |
| Delete a customer for good (not just suspend) | **Customers** → open one → **Delete customer** |
| Create a customer, with anything they have already paid | **Register a customer** |
| Add to a vault directly, move an investment to its real date, change its term, or reverse it | **Customers** → open one → **Add to this vault** / **Change date or term** / **Reverse** |
| See every vault, and convert any cash or other assets still held to Bitcoin | **Vaults** |
| Email or text every customer at once | **Email alerts** |
| Rename the platform | **Settings** |

### Set the vault up first

Under **Settings**:

- **Vault addresses** — the Bitcoin addresses customers send to, one a line,
  optionally followed by a label (`bc1q... Main vault`). Each customer is
  always shown the same one.
- **OTC partner** — the partner's name, bank, payee name, the number to pay,
  routing or sort code, SWIFT and any instructions. Customers pay the partner
  directly and quote their customer number.
- **Default term** — 10 to 100 years. Customers choose their own term within
  that range; this one is preselected and used for conversions.
- **Fee to send** — our own fee, shown on the Send page. The Bitcoin network's
  fee is separate.

### Details for one customer, and customers who ask

What a customer sees on **Receive** comes from, in order:

1. **Their own details**, if you set some: open the customer → **Payment
   details shown to this customer** → **Set details for this customer**. A
   vault address, the OTC payment details, or both. Leave a part blank to use
   the platform's.
2. **The platform's**, from **Settings**.
3. **None** — then Receive shows **Ask for payment details** or **Ask for a
   vault address**. The request arrives under **Requests**; press **Give
   details**, enter them (or leave them blank if Settings now covers it), and
   the customer is emailed that their details are ready. The email never
   contains the details themselves: customers learn to take them only from the
   signed-in page.

### Rename the platform

**Settings** → **Platform name**. Whatever you type replaces the name
everywhere: the logo (the name beside the mark is type, not artwork), every
heading and sentence on the public site and the signed-in pages, the browser
tab, the chat widget, and the sender and text of every email and text message.
"Hedgestone Finance", "Hedge" or anything else; leave it blank for the built-in
name. It shows on the next page anyone opens — no deploy, no rebuild.

The one thing that cannot follow a rename is the picture shown when a link is
shared (`/assets/bank/og-image.png`), so it carries the logo mark and the
Bitcoin-only message but no name.

### Register a customer

**Register a customer** is one form: the person, their identity details, and
optionally what they have already paid the OTC partner.

- **Email** — this is their sign-in. It must not be the same as any other
  account, including the administrator's.
- **First amount into the vault** — the amount, the day they paid and the term.
  It is booked as the Bitcoin that amount bought at that day's closing price.
  Leave it blank and add to their vault later.

On save you get a **temporary password** shown once. Copy it before closing the
panel; it is not recoverable, and the customer is forced to change it on first
sign-in.

### Requests: what comes in and what goes out

**Requests** lists what is waiting for you.

- **Cash through the OTC partner** — the customer says they paid an amount on a
  date. Check it with the partner, then **Confirm**: correct the amount, the
  date or the term to what actually happened if they differ. It is booked at
  Bitcoin's closing price on the date paid, and the customer is told.
- **Bitcoin received** — the customer says they sent an amount to the vault
  address. Check it arrived (the transaction ID helps), then **Confirm** with
  the amount that arrived. It is valued at that day's price.
- **Bitcoin sent out** — the customer asked to send matured Bitcoin to an
  address, and confirmed it with their PIN and an emailed code. The request
  shows how much else of theirs has matured. Make the transfer from the vault
  wallet, then **Mark sent** with its transaction ID. It comes off their vault,
  from what matured first.
- **Asked for cash payment details** / **Asked for a vault address** — see
  above: **Give details**.
- **Reject** any of them with a reason; the customer reads it. A rejected send
  leaves the Bitcoin in their vault.

### Dates, prices and terms

Nothing can be dated before **1 January 2011**, nor in the future. Anything
dated in the past is priced at Bitcoin's closing price on that day, never at
today's, so the growth shown is the growth since that day. On a customer's
record:

- **Add to this vault** — cash they paid or Bitcoin they sent, dated when it
  happened, with a term of 10 to 100 years. Use it for payments made before the
  customer was set up, or confirmed outside a request.
- **Change date or term** — moving an investment reprices it at the new day:
  cash paid keeps its amount and buys what it would have then; Bitcoin received
  keeps its units and is valued at that day. Its maturity moves with it.
- **Reverse** — takes it back out of the vault completely. A conversion cannot
  be reversed.

An investment matures on its date plus its term. Until then it cannot be sent
out; from then it can, when the customer asks.

### What customers had before the vault

Customers who had a cash balance or another asset (the S&P 500, stocks, gold)
have it converted to Bitcoin automatically: the next time they open their
dashboard, or when you open **Vaults**, whichever comes first. It is valued at
the live price and buys Bitcoin, what they originally paid carries over as
invested, it goes on the default term, and they are sent a notice. A
conversion shows as "Converted" and cannot be reversed. If a live price cannot
be had, **Vaults** says how many are waiting; open it again a few minutes
later. Cash held for a withdrawal asked for before the vault stays put until
you release or return it under **Requests** → **Cash withdrawals from before
the vault**; returned, it is converted next time.

### Suspend or delete a customer

- **Suspend** stops them signing in and keeps everything; **Reactivate** undoes it.
- **Delete customer** erases them for good: their login, vault, every movement,
  request, message and document. You type their email address to confirm. The
  activity log keeps a record of who was deleted, by whom, and what their vault
  held. Staff logins, and your own, cannot be deleted this way.

### Everything else worth knowing

- **Email alerts** — compose to one customer or to every active one. It sends
  an email (and a text), and optionally drops a secure message they can reply to.
- **Activity log** — every staff action, attributed, exportable as CSV. Viewing
  a full Social Security number is recorded against whoever looked.
- **Settings** — the platform name, the vault addresses, the OTC partner, the
  default term, the fee to send, verification rules and your contact details.
  Changes take effect on the next request, with no deploy.

### Things that will stop you

| What you see | Why |
| --- | --- |
| "That email address already has an account" | Every address is unique across customers *and* staff |
| A send cannot be confirmed: "has not confirmed this request with their code yet" | The customer has not entered the emailed code. It waits under **Waiting for the customer's code** |
| "Only Bitcoin that has matured can be sent" | Nothing, or not enough, of theirs has reached its maturity date |
| "We cannot get Bitcoin's price for that day" | No history provider answered. Try again in a minute; see the setup checklist's **Price history** |
| "The earliest date that can be used is January 1, 2011" | Nothing is dated before Bitcoin had a daily price |
| A customer cannot sign in | Check their status, and whether they are locked after five failed attempts. The customer drawer has **Clear the lockout** |
| "This database cannot store a term yet", or the setup checklist shows `0007_invest_term.sql` / `0008_vault.sql` as to do | Open **Setup checklist**: **Run this in Supabase** has exactly the SQL that database is missing. **Copy SQL**, run it in the SQL Editor of the project the checklist names, then **Check again**. See below if it stays to do |
| "This is not available yet while the vault is being set up" | The requests table (0008) is missing. Requests are refused rather than saved somewhere they would be lost; run the SQL above |

#### The SQL ran, but the checklist still says to do

- **It ran in a different Supabase project.** The checklist's first Database
  line names the project this site uses (its id is in the Supabase dashboard's
  address bar). SQL run anywhere else changes nothing here.
- **It stopped on an error.** The SQL Editor runs a paste as one transaction:
  one error and *nothing* in it is saved, including everything before the
  error. A run that worked says "Success. No rows returned". Fix or report the
  error and run it again; every statement is safe to repeat.
- **An old copy was used.** Take the SQL from the checklist, or the current
  `supabase/setup.sql`; copies saved before an update lack the newer parts.

The SQL ends with `notify pgrst, 'reload schema';`, which makes Supabase's API
see new tables and columns at once.

---

## Part 2 — email and text messages

Two providers, both optional, both independent. Without either, the bank still
raises every alert and shows it in the customer's **Alerts** screen — only the
delivery is missing.

### Resend, for email

1. Sign up at [resend.com](https://resend.com) and add your domain under
   **Domains**. Add the DNS records it gives you and wait for it to verify.
   Skip this to test: the built-in `onboarding@resend.dev` sender works without
   a domain, but only to your own address.
2. **API Keys** → create one with **Sending access**.
3. In Vercel, **Settings → Environment Variables**, in **Production**:

   | Variable | Value |
   | --- | --- |
   | `RESEND_API_KEY` | the key, `re_...` |
   | `BANK_ALERT_FROM` | `alerts@yourdomain.com` (sent under the platform name from Settings) |
   | `FORM_TO` | where website enquiries should land |
   | `FORM_FROM` | the sender for those, same verified domain |

4. Redeploy. `/api/health` should stop warning about `FORM_TO`.

> Until `RESEND_API_KEY` is set, customers cannot receive the one-time code
> they need to sign in. Staff are unaffected — they have two-factor off.

### Pingram, for text messages

1. Sign up at [pingram.io](https://www.pingram.io) and buy or verify a sending
   number.
2. **API Keys** → create a secret key (`pingram_sk_...`).
3. Add to Vercel, in **Production**:

   | Variable | Value |
   | --- | --- |
   | `PINGRAM_API_KEY` | the secret key |
   | `PINGRAM_SMS_FROM` | your sending number, `+18005559999` |
   | `PINGRAM_DEFAULT_COUNTRY` | optional, `1` by default — the country code assumed for a ten-digit number |
   | `PINGRAM_SMS_URL` | optional, only if their endpoint path differs from `https://api.pingram.io/sms` |

4. Redeploy.

A customer is texted when they have a mobile number that can be read as E.164.
`(614) 555-0184` becomes `+16145550184`; anything ambiguous is skipped rather
than guessed at, because the cost of guessing a country code is a stranger
receiving somebody's balance.

Texts are best effort and separate from email: an SMS outage never marks a
delivered email as failed, and a failed text is recorded on the alert with its
error.

### What the customer gets

Each step of a request is a message, by email and text:

- **When they tell us about a payment or a transfer** — "We have your payment
  details", with the reference and the term they chose.
- **When they ask to send** — the verification code, then "Your request to send
  Bitcoin is with us" once they have entered it.
- **When you confirm** — "0.0123 BTC added to your vault", with the Bitcoin
  price on the day, what was paid or what it was worth, and the maturity date;
  or "0.25 BTC sent from your vault", with the address and transaction ID.
- **When you reject** — "About your request OTC-…", with the reason you gave.

A text reads like this:

> Hedgestone Finance: Your payment of $250.00 has bought 0.00395256 BTC at
> $63,250.00 on October 20, 2026, now in your vault.

All of them are ordinary alerts: stored, visible under **Alerts**. Messages
about requests are always sent; *Bitcoin added to or sent from your vault* can
be switched off by the customer under **Alerts → Preferences**.

### Checking it works

Add a small amount to a test customer's vault from their record and watch:

- the **Email alerts** tab — a new `investment_trade` row, showing `sent` or the
  provider's error;
- the customer's **Alerts** screen — the message, whether or not a provider is
  configured;
- Resend's **Logs** and Pingram's dashboard for the actual delivery.

If an alert says `not_configured`, the provider variable is missing from the
**Production** environment, or there has been no redeploy since it was added.

### Texts recorded as failures

If the console shows an alert as failed while the email plainly arrived, the
database is missing the two columns the text channel writes. Run
**`supabase/migrations/0004_bank_sms.sql`** in the Supabase SQL editor; it is
safe to run twice. `/api/health?probe=1` names the file when they are absent,
under `bank_alerts.sms`.

The application survives without them - it drops the two text fields and
records the email's own status rather than losing it - but nothing about a
text is kept until the migration runs.

### When mail does not arrive

Open **`/api/health?mail=1`**. The plain health check only reads the
environment, which tells you a variable is set and nothing about whether mail
can leave the building. With `?mail=1` it asks Resend directly and reports
what that account actually holds:

```
"mail": {
  "ok": true,
  "domains": [
    { "name": "yourdomain.com", "status": "partially_verified",
      "sending": true, "receiving": false }
  ],
  "sendingAs": "yourdomain.com",
  "receivingOn": "yourdomain.com"
}
```

That example is the state worth knowing about, because it looks healthy from
every angle except the one that matters. A domain is verified for **sending**
by the SPF and DKIM records; it is verified for **receiving** by a separate MX
record that most people never add, having no reason to. Mail then leaves
perfectly, the provider's log says delivered, and anything addressed *to* that
domain has nowhere to land. The warnings say which of the two is missing and
name the variable that depends on it.

Two further things it catches: a `from` address on a domain the account does
not hold at all, which refuses every send; and notifications addressed into
the bank's own inbound mailbox, which travel out through the API and back in
through the webhook onto the message desk, and no further unless `FORWARD_TO`
carries them to an inbox somebody opens.

`/api/health` also reports, under `bank.settings`, the contact details the
console has saved - as opposed to the ones the code ships. A settings row
written before a domain move keeps the old address, and since it then differs
from the shipped default it is read as a deliberate choice and wins, so a page
can go on printing an address nobody reads long after the code changed.
