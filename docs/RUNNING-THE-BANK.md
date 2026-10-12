# Running the bank

Day-to-day operation of Rockfield from the staff console, and how to wire up
the two things that reach a customer outside the app: email and text messages.

Everything here happens at **`/console`**. You get there by signing in at
`/signin` with an account whose role is `admin` — there is no separate console
login. See [DEPLOYMENT.md](DEPLOYMENT.md#two-sign-ins-and-which-is-which) if
that sentence is surprising.

---

## Part 1 — the console

### The short version

| To do this | Go here |
| --- | --- |
| Create a customer and their first account | **Register a customer** |
| Put money into an account, any amount | **Customers** → open one → **Adjust** |
| Open a second or third account for them | **Customers** → open one → **Open another account** |
| Move money between a customer's own accounts | Two adjustments, or have them do it in online banking |
| Release or return a payment they have sent | **Transfer queue** |
| Accept or bounce a photographed cheque | **Check deposits** |
| Issue or freeze a card | **Cards**, or the customer drawer |
| Email or text every customer at once | **Email alerts** |
| Change limits, fees, or the bank's phone number | **Settings** |

### Register a customer

**Register a customer** is one form and it does the whole thing: the person,
their identity details, their first account, an opening balance, and a card if
you want one.

The fields that matter:

- **Email** — this is their sign-in. It must not be the same as any other
  account, including the administrator's.
- **Product** — which account to open. Everyday Checking is the usual first one.
- **Opening balance** — the account opens with this in it, posted as a dated
  ledger entry described as "Opening deposit". Leave it at zero and credit it
  afterwards if you prefer.
- **Issue a card** — ticks out a debit card against the new account.

On save you get a **temporary password** shown once. Copy it before closing the
panel; it is not recoverable, and the customer is forced to change it on first
sign-in. The account is usable immediately.

### Credit an account with any amount

**Customers** → click the customer → find the account → **Adjust**.

| Field | What it does |
| --- | --- |
| **Direction** | Credit (money in) or Debit (money out) |
| **Amount** | Any figure. There is no ceiling on an adjustment — the daily limits apply to customer transfers, not to staff entries |
| **Description on the statement** | What the customer reads. "WIRE IN — MERIDIAN LOGISTICS", not "adjustment" |
| **Method** | Wire, ACH, card, cash, cheque, adjustment. Choosing ACH generates a real trace number |
| **Status** | **Posted** changes the balance now. **Pending** reserves the funds and shows as pending until you settle it |
| **Value date** | Backdate an entry. The statement and the running balance use this, not today |
| **Counterparty** | Who it came from. Appears on the statement and in the wire details |
| **Memo** | A line the customer sees under the entry |

Press **Post**. The balance moves immediately and the customer is emailed — and
texted, once Part 2 is set up. See [what the customer gets](#what-the-customer-gets).

> A credit posted this way is a real ledger entry, not a number typed into a
> field. It appears on their statement, in their CSV export, in their running
> balance, and in the activity log against your name.

### Move money between a customer's own accounts

There is no "transfer" button in the console, deliberately — staff adjust
ledgers, customers move money. Two ways:

**Two adjustments.** Debit the source, credit the destination, same amount,
same description. Use the value date to make both land on the same day.

**Have the customer do it.** In online banking, **Transfers** → *Between my
accounts*. Internal transfers clear immediately and never enter the review
queue, because both legs are on the bank's own books. Anything leaving the
bank — ACH, wire, instant send, bill pay — goes to the queue if review is on.

### The transfer queue

Outgoing payments wait here when **Hold outside transfers for review** is on in
Settings, or when they are over the review threshold.

- **Release** — the money leaves, the hold clears, an ACH trace number or a
  Fedwire IMAD is attached, and the customer is told.
- **Return** — pick a reason. The customer sees the reason, and the held funds
  go straight back to their available balance.

### Everything else worth knowing

- **Check deposits** — accept or bounce a photographed cheque. An accepted one
  posts under a Regulation CC hold: the first $225 the next business day, the
  rest in two.
- **Cards** — issue, freeze, set a daily limit, or report lost or stolen. A
  frozen card declines at the terminal immediately.
- **Claims** — a customer disputing a transaction. Resolve as upheld, declined,
  or provisional credit.
- **Email alerts** — compose to one customer or to every active one. It sends
  an email (and a text), and optionally drops a secure message they can reply to.
- **Activity log** — every staff action, attributed, exportable as CSV. Viewing
  a full Social Security number is recorded against whoever looked.
- **Settings** — daily limits, the fee schedule, verification rules, and the
  bank's own contact details. Changes take effect on the next request, with no
  deploy.

### Things that will stop you

| What you see | Why |
| --- | --- |
| "That email address already has an account" | Every address is unique across customers *and* staff |
| A transfer stuck in the queue | Review is on. Release it, or turn the rule off in Settings |
| A customer cannot sign in | Check their status, and whether they are locked after five failed attempts. The customer drawer has **Clear the lockout** |
| A card declining | Frozen, over its daily limit, or international use is off |

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
   | `BANK_ALERT_FROM` | `Rockfield National Bank <alerts@yourdomain.com>` |
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

> Rockfield National Bank: $2,500.00 credited to Everyday ••••2835.
> Current balance $16,447.26. Ref TXN-5EAUZ-JQ5M2

**2. What they can actually spend.**

> Rockfield National Bank: Available to spend on Everyday ••••2835 is
> $16,879.84. $67.42 is on hold and will be released as it clears, and this
> includes your $500.00 overdraft line.

Two messages rather than one because they answer two different questions, and
the answers are different numbers. The current balance is what the statement
says. The available balance is what works at a card terminal — lower when
something is on hold, higher when the account has an overdraft line. Put both
figures in one message and people read the wrong one.

The same pair goes out by email, in more detail, with the reference and the
counterparty.

Both are ordinary alerts: stored, visible under **Alerts**, and switchable by
the customer under **Alerts → Preferences** as *Deposit posted* and *Available
balance after money arrives*.

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
