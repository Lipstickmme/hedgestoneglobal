# Rebuilding this stack on another site

Ported from the tested build at `Lipstickmme/hospital`. The schema, the
security model and the email plumbing transfer unchanged; the front end here is
static HTML and vanilla JS rather than TanStack Start, so the client-side parts
are written differently while making the same decisions.

The banking application at `src/bank/` was built on top of that base and is
described at the end of this file. It keeps its own session system rather than
using Supabase auth, because a customer signing into a bank is not the same
actor as a member of staff signing into the desk.

## File structure

```
supabase/
  migrations/0001_init.sql   admins, is_admin(), item_status, enquiries,
                             chat_sessions, chat_messages, touch trigger,
                             realtime publication
  migrations/0002_email.sql  email_threads, email_messages, touch trigger
  grant-admin.sql            one-off: make yourself an admin
src/
  utils/
    config.js                resolves env under every accepted name; knows
                             which addresses are "ours" and whether FORWARD_TO
                             would loop
    supabase.js              service-role PostgREST client (server only)
    storage.js               enquiries: Supabase, or local files in dev
    chatStore.js             chat transcripts: Supabase, or local files
    notify.js                Resend send + optional desk webhook
    webhookSignature.js      Svix HMAC over the raw request bytes
  controllers/
    systemController.js      /api/public-config, /api/health
    contactController.js     validation, honeypot, write, notify
    chatController.js        rule-based responder + notification
    inboundController.js     signed webhook -> email_threads -> forward
  routes/                    mounted under /api
  site/                      build-time page source (layout.js, pages.js)
public/                      generated pages, CSS, JS, assets
api/[...path].js             Vercel serverless entry (the whole API)
```

## The five decisions that matter

1. **Visitors authenticate anonymously.** `signInAnonymously()` gives each
   visitor a real `auth.uid()`, so RLS grants them their own chat and nothing
   else, with no token scheme of our own and no service-role key in the
   browser. Requires enabling Anonymous under Authentication, Providers.
   *Schema and `/api/public-config` are in place; the widget does not use them
   yet (see Status).*

2. **Forms never touch the database from the browser.** `enquiries` has no anon
   policy at all; writes go through `POST /api/contact`, which holds the
   service-role key. A leaked anon key cannot stuff the inbox. **Done.**

3. **Chat rows are written from the browser**, under the visitor's own session,
   because RLS can express "your own session" precisely. The server is used for
   the staff notification and the holding reply, which is the one thing the
   browser cannot decide: whether a person has already taken the thread over.
   **Done.**

4. **The browser's Supabase config is served at runtime** by
   `/api/public-config`, not inlined at build time, so no key needs a public
   prefix and no change needs a rebuild. **Done.**

5. **Live updates run under the same RLS**, so a visitor only ever receives rows
   from their own session. Here that is a four-second poll of the same query
   rather than a `postgres_changes` subscription: this site has no bundler and
   no runtime dependencies, and `@supabase/supabase-js` is the only way to
   subscribe. The tables are in the `supabase_realtime` publication, so
   swapping the poll for a subscription is a client change alone.

## Status

Both halves are built and verified end to end in Chromium against a mock that
enforces the schema and the policies: a visitor opens a chat and writes their
own rows, staff sign in at `/admin`, read it and reply, the reply reaches the
visitor without a reload, and the canned responder stands down. Enquiries,
triage, studio mail, the schema probe, and the two fallbacks (anonymous
sign-ins off; no database at all) are covered by the same suites.

`npm test` runs the API and schema checks with no dependencies at all.
`npm run test:browser` runs the end-to-end pair and needs `playwright-core`.

Not built: replying to studio mail from the dashboard. Sending needs the Resend
key, which is server side, so it wants an authenticated API route rather than a
direct PostgREST write. The threads are read-only until then, with a mailto
link out to your own client.

One thing to know when porting: this stack has no browser bundler, so
`supabase-js` is replaced by `public/js/supabase-lite.js`, roughly 150 lines
calling the same GoTrue and PostgREST endpoints. On a site that already has a
bundler, use the real client and take realtime with it.

## Traps this hit, worth pre-empting

- **Porting a schema is only half a port.** This repo took the two-table chat
  (`chat_sessions` + `chat_messages`, `sender`/`body`) and left the writer
  sending the old flat shape (`role`/`text`). Every insert was rejected, and
  because the controller treats persistence as best effort, the visitor still
  got a reply and nothing looked broken until the table stayed empty. Two
  guards now: `/api/health?probe=1` reads every column the code uses, and the
  test mock rejects an unknown column exactly as Postgres does.
- **`visitor_id uuid not null default auth.uid()`** is null under the service
  role, so any server-side insert into `chat_sessions` must supply it. The
  fallback path derives a stable uuid from the widget's token rather than
  generating a random one, so a returning visitor lands on the same row.

- A bare `import "./x"` for its side effect is **tree-shaken away** when
  `package.json` has `"sideEffects": false`. Export a function and call it.
  *(Not applicable here: no bundler.)*
- A global middleware runs for *every* request, including the one that fetches
  config. Guard it, or it constructs a client with an empty URL and 500s the
  whole app. *(Checked here: malformed JSON returns 400, oversized 413, wrong
  content-type 422, and the server stays up.)*
- Vercel deploys the repository's **default branch**. Pushing to `main` when
  the default is something else deploys nothing.
- `FORWARD_TO` on your own domain loops mail back into the inbound webhook
  until the sending quota is gone. **Guarded**: `/api/health` warns, and the
  webhook refuses to forward to any address the site sends or receives as.
- A lockfile from a hosted builder can pin a **private registry** the deploy
  cannot authenticate to. *(This lockfile is public npm, `express` only.)*
- **Set `"framework": null` in `vercel.json`.** With `express` in
  `dependencies`, Vercel auto-detects a Node server preset and, after a
  perfectly successful build, looks for a server entrypoint in the output
  directory: `No entrypoint found in output directory: "public"`. Declaring no
  framework makes it serve `public/` statically with `api/` as functions. This
  one bit us for real.
- **`.vercelignore` matches at any depth.** A pattern like `data/` excludes
  `src/data/` too, so content the build reads never reaches the deploy and it
  dies on a file that is present locally. Anchor with a leading slash: `/data/`.
  `npm run check:vercel` simulates the upload and fails if anything the build
  requires would be excluded. This one bit us for real.


---

## The banking layer

Added on top of the stack above. The website side (enquiries, chat, mail, the
desk at `/admin`) is untouched and still uses Supabase auth; the bank has its
own everything.

```
src/bank/
  constants.js     the institution, products, limits, fees, alert types
  db.js            collections over Supabase or JSON files, with update/delete
  ids.js           account numbers, cards, ABA and Luhn checks, ACH trace, IMAD
  security.js      scrypt for secrets, AES-256-GCM for SSNs and card numbers
  auth.js          server-side sessions, CSRF, one-time codes, lockout
  ledger.js        post / settle / reverse, per-account locking
  transfers.js     submit -> verify -> review -> complete | reject
  users.js         creating a customer, and what may leave the server
  accounts.js      opening accounts, issuing cards
  alerts.js        notification rows first, branded email second
  audit.js         the activity log every action writes to
  settings.js      operator overrides on top of the defaults
  seed.js          first-run data with six months of history
```

### The six decisions that matter here

1. **Money is integer cents, everywhere.** No float touches a balance. The one
   place dollars exist is `toCents()` at the edge of a request.

2. **Balances change only in `ledger.js`, inside a per-account lock.** Every
   change writes a transaction row, including a staff adjustment. There is no
   code path that sets a balance directly, which is why every number on every
   screen can be traced to an entry.

3. **Pending is not posted.** A pending debit moves `hold_amount`, not
   `balance`, and `availableFor()` is what the customer is allowed to spend.
   Settling converts the hold into a posting in one locked step. This is what
   stops held funds being spent twice while a transfer clears.

4. **Sessions are rows, not JWTs.** The browser holds an opaque token in an
   httpOnly cookie; the database holds its SHA-256 digest. That makes "sign out
   this device" and "sign out everywhere" real operations, and makes a stolen
   dump useless for session replay. A second, readable cookie carries the CSRF
   token every state-changing request must echo.

5. **Reversible secrets are encrypted, not hashed.** A bank has to show the
   last four of an SSN on a form and the whole thing to a compliance officer,
   so SSNs, ID numbers and card numbers use AES-256-GCM under
   `BANK_ENCRYPTION_KEY`. Passwords and PINs, which never need reading back,
   are scrypt.

6. **Alerts are recorded before they are sent.** `alerts.notifyUser()` writes
   the row, then attempts Resend and records what happened. The customer sees
   the notification whether or not mail is configured, and the console can show
   which ones failed to leave.

### Traps worth pre-empting

- **Daily limits must count the value date, not `created_at`.** Seeded and
  backdated entries are written today but happened months ago; counting those
  spends a customer's limit before they have used it.
- **A hold applies on the direction, not the sign.** On a deposit account a
  pending debit reduces available funds; on a credit card it reduces available
  credit. Keying the hold off `direction === 'debit'` covers both; keying it
  off the signed delta silently skips the card.
- **`a { color: inherit }` beats `.rf-btn { color: #fff }`.** A blanket anchor
  rule with a descendant selector outranks a single class, so an anchor styled
  as a button loses its label colour. The override is in `bank.css`.
- **One `[data-x]` attribute, one meaning.** A hint element and a set of
  `<option>` rows both answering to `[data-available]` meant `querySelector`
  found the option and overwrote it.
