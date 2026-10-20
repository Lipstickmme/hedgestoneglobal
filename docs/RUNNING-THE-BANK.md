# Running the platform

Day-to-day operation of Hedgestone Finance from the staff console, and how to
wire up the two things that reach a customer outside the site: email and text
messages.

Everything here happens at **`/console`**. You get there by signing in at
`/signin` with an account whose role is `admin` — there is no separate console
login. See [DEPLOYMENT.md](DEPLOYMENT.md#two-sign-ins-and-which-is-which) if
that sentence is surprising.

The platform does one thing: customers invest in **Bitcoin only**. Each has a
cash balance, which holds money waiting to buy Bitcoin and receives the
proceeds of a sale, and the Bitcoin itself, bought in purchases that each carry
a term and a maturity date. There are no cards, cheques, bill payments,
statements or payments between customers.

---

## Part 1 — the console

### The short version

| To do this | Go here |
| --- | --- |
| Create a customer and their cash balance | **Register a customer** |
| Put money into a cash balance, any amount | **Customers** → open one → **Adjust** |
| Buy or sell Bitcoin for a customer, or change a purchase's term | **Customers** → open one → **Book a purchase or sale** / **Change date or term** |
| Release or return a withdrawal | **Withdrawals** |
| See who holds what, and convert any other assets still held to Bitcoin | **Bitcoin investments** |
| Email or text every customer at once | **Email alerts** |
| Rename the platform, set the terms on offer, limits and fees | **Settings** |

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

**Register a customer** is one form and it does the whole thing: the person,
their identity details, their cash balance and the money they start with.

- **Email** — this is their sign-in. It must not be the same as any other
  account, including the administrator's.
- **Opening deposit** — the cash balance opens with this in it, posted as a
  dated ledger entry described as "Opening deposit". Leave it at zero and
  credit it afterwards if you prefer.

On save you get a **temporary password** shown once. Copy it before closing the
panel; it is not recoverable, and the customer is forced to change it on first
sign-in.

### Credit a cash balance

**Customers** → click the customer → **Adjust** on their cash balance.

| Field | What it does |
| --- | --- |
| **Direction** | Credit (money in) or Debit (money out) |
| **Amount** | Any figure. Daily limits apply to customer withdrawals, not to staff entries |
| **Description the customer sees** | "DEPOSIT RECEIVED", not "adjustment" |
| **Method, Category** | How it arrived and how it is filed |
| **Status** | **Posted** changes the balance now. **Pending** reserves it until you settle it |
| **Value date** | Date an entry to when the money actually arrived |
| **Paid by, Their bank, Memo** | Shown to the customer under the entry |

The balance moves immediately and the customer is emailed — and texted, once
Part 2 is set up. See [what the customer gets](#what-the-customer-gets).

### Bitcoin, terms and maturity

Customers buy Bitcoin themselves from **Bitcoin** (`/invest`), choosing an
amount and a term from the ones offered under **Settings** → **Bitcoin terms**
(3, 6, 12 and 24 months to start with; the default is preselected). A purchase
matures on its purchase date plus its term. The dashboard shows each purchase
with what it cost, what it is worth at the live price, its growth, and a
countdown to maturity, and charts the value of what they hold since their first
purchase against what they paid.

A maturity date is a plan, not a lock: a customer can sell before it, and
nothing happens automatically on the day. It is not a promise of any value.

From the customer drawer, staff can **Book a purchase or sale** (at an agreed
price, an earlier time and any whole number of months), **Change date or term**
on a purchase (its maturity moves with it), or **Reverse** one completely.

Customers who bought another asset before the platform became Bitcoin only
(the S&P 500, stocks, gold) have it converted to Bitcoin automatically: the
next time they open their dashboard, or when you open **Bitcoin
investments**, whichever comes first. Each holding is valued at its live price
and that value buys Bitcoin; what they originally invested carries over, and
they are sent a notice. A conversion shows as "Converted" in their purchases
and cannot be reversed. If a live price for the old asset cannot be had,
**Bitcoin investments** says how many are waiting; open it again a few
minutes later to convert them.

### Withdrawals

A customer withdraws from their cash balance to a bank account in their own
name, saved under **Withdrawal accounts**. Withdrawals wait in **Withdrawals**
when **Hold withdrawals for review** is on in Settings, or when they are over
the review threshold.

- **Release** — the money leaves, the hold clears, and the customer is told.
- **Return** — pick a reason. The customer sees it, and the held funds go
  straight back to their cash balance.

### Everything else worth knowing

- **Email alerts** — compose to one customer or to every active one. It sends
  an email (and a text), and optionally drops a secure message they can reply to.
- **Activity log** — every staff action, attributed, exportable as CSV. Viewing
  a full Social Security number is recorded against whoever looked.
- **Settings** — the platform name, the Bitcoin terms, withdrawal limits and
  fees, verification rules and your contact details. Changes take effect on the
  next request, with no deploy.

### Things that will stop you

| What you see | Why |
| --- | --- |
| "That email address already has an account" | Every address is unique across customers *and* staff |
| A withdrawal stuck in the queue | Review is on. Release it, or turn the rule off in Settings |
| A customer cannot sign in | Check their status, and whether they are locked after five failed attempts. The customer drawer has **Clear the lockout** |
| Buying is refused with "no live price" | No price provider answered for two minutes. See the setup checklist's **Live Bitcoin price** |
| "This database cannot store a term yet" | Run `supabase/setup.sql` again; it adds the term columns (0007) |

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

Money arriving raises **two messages, in this order**:

**1. It has landed.**

> Hedgestone Finance: $2,500.00 credited to Cash balance ••••2835.
> Current balance $16,447.26. Ref TXN-5EAUZ-JQ5M2

**2. What they can actually use.**

> Hedgestone Finance: Available to invest or withdraw from Cash balance ••••2835 is
> $16,379.84. $67.42 is on hold and will be released as it clears.

Two messages rather than one because they answer two different questions, and
the answers are different numbers. The current balance is what is in the cash
balance. The available balance is what can buy Bitcoin or be withdrawn — lower
when something is on hold, such as a withdrawal waiting for review. Put both
figures in one message and people read the wrong one.

The same pair goes out by email, in more detail, with the reference and the
counterparty.

Both are ordinary alerts: stored, visible under **Alerts**, and switchable by
the customer under **Alerts → Preferences** as *Money added to your cash
balance* and *Cash available to invest after money arrives*.

To send only the first, set `availableBalanceAlert` to `false` in the
`settings` record.

### Checking it works

Credit a test customer a small amount from the console and watch:

- the **Email alerts** tab — two new rows, `deposit_posted` and
  `balance_available`, each showing `sent` or the provider's error;
- the customer's **Alerts** screen — both messages, whether or not a provider
  is configured;
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
