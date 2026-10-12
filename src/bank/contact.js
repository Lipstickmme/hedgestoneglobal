'use strict';

/**
 * How to reach the bank: the telephone numbers, the postal address and the
 * hours, as an operator has set them at the staff console.
 *
 * None of these ship with a value. A bank's contact details are the one thing
 * that cannot be invented - a placeholder number on a live site is a number
 * somebody will ring - so constants.js leaves them blank and this module is
 * the only place that reads them.
 *
 * The phrasing helpers exist because a sentence built around a number has to
 * survive not having one. `call 1-800-555-0142` and `contact us` are both
 * correct endings to "If this was not you, ...", but `call .` is not, and that
 * is what a bare template literal produces the day someone deploys without
 * filling the field in.
 */

const settings = require('./settings');

/** Trimmed string, or '' - a setting can be null, absent, or whitespace. */
const str = (value) => (value == null ? '' : String(value).trim());

/**
 * The current details, synchronously.
 *
 * Reads settings.snapshot(), so it is as fresh as the last settings read -
 * a few seconds at worst, and these change a few times a decade.
 */
function current() {
  // A cold cache reads as "nothing is set", which is the safe answer but not
  // always the true one, so ask for a read that the next caller will get the
  // benefit of. src/app.js does this at boot; this covers anything that gets
  // in first.
  if (!settings.snapshot.warm()) settings.get().catch(() => {});
  const cfg = settings.snapshot();
  return {
    phone: str(cfg.supportPhone),
    fraudPhone: str(cfg.fraudPhone),
    internationalPhone: str(cfg.internationalPhone),
    address: str(cfg.mailingAddress),
    hours: str(cfg.supportHours),
    email: str(cfg.supportEmail),
  };
}

/** The same, guaranteed current. Use where the call site is already async. */
async function load() {
  await settings.get();
  return current();
}

/** `tel:` target for a number typed in any human format. */
const telHref = (value) => `tel:${str(value).replace(/[^+\d]/g, '')}`;

/**
 * "call 1-800-555-0142", or "contact us" when no number is set.
 *
 * Written to drop into the middle of a sentence, so both forms read as English
 * wherever it lands: "If this was not you, <callFraud()> immediately."
 */
function callFraud() {
  const { fraudPhone, phone } = current();
  const number = fraudPhone || phone;
  return number ? `call ${number}` : 'contact us';
}

/** The same for the general support line. */
function callSupport() {
  const { phone, fraudPhone } = current();
  const number = phone || fraudPhone;
  return number ? `call ${number}` : 'contact us';
}

/**
 * "Questions: 1-800-555-0142" - or nothing at all.
 *
 * Returns '' when unset, so a caller can drop it from a list of lines rather
 * than printing a label with nothing after it.
 */
function supportLine(label = 'Questions') {
  const { phone } = current();
  return phone ? `${label}: ${phone}` : '';
}

/**
 * The address as one line, for an email footer or a postal block.
 *
 * '' when unset, which is the signal to leave the whole row out.
 */
function addressLine() {
  return current().address;
}

module.exports = { current, load, telHref, callFraud, callSupport, supportLine, addressLine };
