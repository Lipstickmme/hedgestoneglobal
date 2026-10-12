'use strict';

/**
 * The bank's public contact details, as one record.
 *
 * There are two places an operator can set these, for historical reasons the
 * site should not have to care about:
 *
 *   - the bank's staff console, under Settings, which writes the `settings`
 *     collection and therefore works on JSON files as well as on Supabase;
 *   - the client services desk at /admin, which writes the `site_settings`
 *     table directly and needs Supabase.
 *
 * The console wins where it has a value, because it is the one that works
 * everywhere. Whatever it leaves blank falls through to the desk, and then to
 * the built-in defaults in src/data/site.json - which are themselves blank for
 * the address and the telephone numbers. Nothing here invents a value: a
 * detail nobody has set comes back as '' and the page leaves its row out.
 */

const defaults = require('../data/site.json');
const { getSupabase } = require('./supabase');
const bankSettings = require('../bank/settings');

const TABLE = 'site_settings';
const ROW_ID = 'default';
/** What /api/site serves. The last two are read-only here; only the console sets them. */
const FIELDS = ['address', 'email', 'phone', 'hours', 'fraudPhone', 'internationalPhone'];

/** Trimmed string, or '' - a stored value can be null, absent or whitespace. */
const str = (value) => (value == null ? '' : String(value).trim());

/*
 * Addresses this application has shipped as its own default and since
 * retired.
 *
 * `configured()` below counts a stored console value as deliberate when it
 * differs from what we ship now. That is right for a value somebody typed and
 * wrong for one the seed wrote, because the console's support email is seeded
 * from the institution's own. So when the bank moved domain, every deployment
 * was left holding a settings row with the old address - which now differed
 * from the default and therefore outranked it, permanently, and went on being
 * printed on every public page long after the code had moved on. Nothing
 * about that is visible from outside: the page simply shows an address nobody
 * reads.
 *
 * A stored value matching a retired default was never a choice. Listing them
 * is the only way to tell inheritance from intent after the fact. An operator
 * who really wants one of these types it again, and the next line of this
 * list retires it when it stops being ours.
 */
const RETIRED = {
  email: ['support@rockfieldbank.com'],
};

/** True when a stored value is one we used to ship rather than one chosen. */
const inherited = (key, value) =>
  (RETIRED[key] || []).includes(str(value).toLowerCase());

/** The first of these that has anything in it. */
const firstOf = (...values) => values.map(str).find(Boolean) || '';

/** Only the fields we own, trimmed, blanks preserved as blanks. */
function normalise(values) {
  const out = {};
  FIELDS.forEach((key) => {
    out[key] = firstOf(values && values[key], defaults[key]);
  });
  return out;
}

/** The contact block as the staff console has it. */
function fromConsole(cfg) {
  return {
    address: str(cfg.mailingAddress),
    email: str(cfg.supportEmail),
    phone: str(cfg.supportPhone),
    hours: str(cfg.supportHours),
    fraudPhone: str(cfg.fraudPhone),
    internationalPhone: str(cfg.internationalPhone),
  };
}

async function read() {
  let console_ = {};
  try {
    console_ = fromConsole(await bankSettings.get());
  } catch (err) {
    // The settings collection is optional; the desk and the defaults stand.
  }

  let desk = {};
  let source = 'defaults';
  const supabase = getSupabase();
  if (supabase) {
    try {
      const rows = await supabase.select(TABLE, `select=*&id=eq.${ROW_ID}&limit=1`);
      if (rows.length) {
        desk = rows[0];
        source = 'database';
      }
    } catch (err) {
      // The table arrives with 0001_init.sql. Without it the console is still
      // able to set everything; these details just cannot be edited at /admin.
    }
  }
  // "Has a value" is not the same as "somebody set it": the console's support
  // email is seeded from the institution's own, so taking every non-empty
  // console value as an override would let that seed outrank an address a
  // person actually typed at the desk. A console value counts as configured
  // only where it differs from what we ship, and only then does it win.
  // A retired default is dropped before either test: it is neither a choice
  // nor worth preferring over the address we ship today.
  const stored = (key) => (inherited(key, console_[key]) ? '' : console_[key]);
  const configured = (key) => (stored(key) && stored(key) !== str(defaults[key]) ? stored(key) : '');

  if (FIELDS.some(configured)) source = 'settings';

  const merged = {};
  FIELDS.forEach((key) => { merged[key] = firstOf(configured(key), desk[key], stored(key), defaults[key]); });
  return { ...merged, source };
}

module.exports = { read, normalise, defaults, FIELDS, TABLE, ROW_ID };
