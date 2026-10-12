'use strict';

/**
 * One place that resolves configuration from the environment.
 *
 * Several names are accepted for the same value because different Supabase
 * integrations inject different ones: Vercel's uses SUPABASE_URL /
 * SUPABASE_ANON_KEY / SUPABASE_SECRET_KEY, while projects set up for a Vite or
 * Next front end carry VITE_ and NEXT_PUBLIC_ prefixes.
 *
 * The anon key is public by design: row level security is what protects the
 * data, not the secrecy of that key. The service-role key is the opposite and
 * must never leave the server.
 */

const pick = (...names) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
};

const supabaseUrl = () =>
  pick('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL');

/**
 * The browser key, under every name Supabase and its integrations have used
 * for it. Projects created under the older scheme call it the anon key;
 * projects created under the newer API keys scheme call it the publishable
 * key, and the Vercel integration injects SUPABASE_PUBLISHABLE_KEY for those.
 * Missing that name is why a correctly configured deployment can still tell
 * you the backend is not connected.
 */
const supabaseAnonKey = () =>
  pick(
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY'
  );

/** The secret key. `sb_secret_...` under the newer scheme, service_role under the older. */
const supabaseServiceKey = () =>
  pick('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');

const resendApiKey = () => pick('RESEND_API_KEY');

/** True when this process looks like a deployment rather than a laptop. */
const isDeployed = () =>
  Boolean(pick('VERCEL', 'VERCEL_ENV', 'RENDER', 'FLY_APP_NAME')) ||
  process.env.NODE_ENV === 'production';

/**
 * Whether a one-time code may be handed back in an API response.
 *
 * Without a mail provider a code cannot reach anybody, so returning it keeps
 * local development able to sign into itself. On a deployment the same
 * behaviour is an account takeover: /auth/forgot would hand a reset code to
 * anyone who knows an address, and /auth/reset would take it. So it is off
 * wherever this looks deployed, and off whenever mail is configured, unless
 * BANK_SHOW_DEV_CODES explicitly turns it back on for a demonstration.
 */
function showDevCodes() {
  const forced = pick('BANK_SHOW_DEV_CODES');
  if (forced) return /^(1|true|yes|on)$/i.test(forced);
  if (resendApiKey()) return false;
  return !isDeployed();
}
const resendWebhookSecret = () => pick('RESEND_WEBHOOK_SECRET');

const formTo = () => pick('FORM_TO', 'CONTACT_NOTIFY_EMAIL');
const formFrom = () => pick('FORM_FROM', 'NOTIFY_FROM') || 'Rockfield National Bank <onboarding@resend.dev>';
const mailboxAddress = () => pick('MAILBOX_ADDRESS');
const forwardTo = () => pick('FORWARD_TO');

/**
 * The name a recipient sees beside the address. Without one, mail clients fall
 * back to the local part, so a reply from contact@ shows up as "contact".
 */
const senderName = () => pick('BANK_NAME', 'STUDIO_NAME') || 'Rockfield National Bank';

/** Bare address out of "Name <a@b.c>". */
function parseAddress(value) {
  const raw = String(value || '').trim();
  const angled = /<([^>]+)>/.exec(raw);
  const email = (angled ? angled[1] : raw).trim().toLowerCase();
  const name = angled ? raw.slice(0, angled.index).trim().replace(/^"|"$/g, '') : '';
  return { name, email };
}

/**
 * Every address this site sends or receives as. Forwarding to one of these
 * would loop mail back into the inbound webhook.
 */
function ownAddresses() {
  return new Set(
    [mailboxAddress(), formFrom(), formTo()]
      .map((v) => parseAddress(v).email)
      .filter(Boolean)
  );
}

/** True when FORWARD_TO points at one of our own addresses. */
function forwardWouldLoop() {
  const target = parseAddress(forwardTo()).email;
  return Boolean(target) && ownAddresses().has(target);
}

const domainOf = (address) => {
  const at = String(address || '').lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1);
};

/**
 * Which FORM_TO recipients sit on the domain this site receives mail for.
 *
 * Setting up inbound means pointing that domain's MX records at the provider,
 * which hands every message to this application's webhook. Addressing the
 * site's own notifications to an address on that domain therefore sends them
 * in a circle: out through the API, back in through the webhook, onto the
 * message desk - and no further, unless FORWARD_TO carries them to a mailbox
 * somebody actually opens.
 *
 * It looks like it is working from both ends. The provider's log says the
 * message was delivered, because it was; the desk shows it arriving, because
 * it did. The only thing missing is the inbox, which is the one place the
 * person is looking.
 */
function formToOnInboundDomain() {
  const domain = domainOf(parseAddress(mailboxAddress()).email);
  if (!domain) return [];
  return String(formTo() || '')
    .split(',')
    .map((part) => parseAddress(part).email)
    .filter((address) => address && domainOf(address) === domain);
}

/**
 * The site's own absolute address.
 *
 * Used wherever a link has to survive leaving the page it was made on: the
 * buttons inside an alert email, the link card scrapers fetch, a transfer
 * receipt. A relative path is fine in a browser and useless in an inbox.
 *
 * Three names are accepted, and the reason is Vercel. PUBLIC_BASE_URL is the
 * documented one, but Vercel reads the PUBLIC_ prefix as a front-end
 * framework's public prefix - the one Astro, Nuxt and SvelteKit inline into
 * the browser bundle - and refuses to store such a variable as a secret:
 *
 *   Environment variables with a public framework prefix cannot use
 *   `visibility: secret`. Use `visibility: config` instead.
 *
 * Saving it as plain text is the right answer and is what the deployment
 * guide says, since this is a domain name rather than a secret. But a project
 * or team that has sensitive variables switched on by policy cannot save it
 * either way, and nobody should have to argue with a form over the name of
 * their own website. BANK_BASE_URL and APP_URL carry no prefix and do the
 * same job.
 *
 * Trailing slashes are trimmed here so that callers can append a path without
 * each one remembering to.
 */
function baseUrl() {
  const set = pick('PUBLIC_BASE_URL', 'BANK_BASE_URL', 'APP_URL');
  const vercel = pick('VERCEL_URL');
  const value = set || (vercel ? `https://${vercel}` : 'https://rockfieldglobalfinance.com');
  return value.replace(/\/+$/, '');
}

const ACCEPTED_NAMES = {
  supabaseUrl: ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL'],
  supabaseAnonKey: [
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
  ],
  supabaseServiceRoleKey: ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'],
  baseUrl: ['PUBLIC_BASE_URL', 'BANK_BASE_URL', 'APP_URL'],
};

module.exports = {
  ACCEPTED_NAMES,
  pick,
  baseUrl,
  isDeployed,
  showDevCodes,
  supabaseUrl,
  supabaseAnonKey,
  supabaseServiceKey,
  resendApiKey,
  resendWebhookSecret,
  formTo,
  formFrom,
  mailboxAddress,
  forwardTo,
  senderName,
  // STUDIO_NAME is still read above, and the old export name still answers,
  // because a deployment may have either set. Neither is worth breaking over
  // a word.
  studioName: senderName,
  parseAddress,
  ownAddresses,
  forwardWouldLoop,
  formToOnInboundDomain,
};
