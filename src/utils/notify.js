'use strict';

/**
 * Routes enquiries, chat messages and inbound mail to a human inbox.
 *
 * Channels (independent, each a no-op until configured):
 *   1. Email via Resend  ->  RESEND_API_KEY + FORM_TO (or CONTACT_NOTIFY_EMAIL)
 *   2. Webhook           ->  NOTIFY_WEBHOOK_URL (Slack, Discord, Zapier, desk)
 *
 * Delivery is best effort: failures are logged and never break the request.
 * Calls are awaited so a serverless function does not exit early.
 */

/* Resolved per call rather than at load, so a test - or anyone putting their
   own gateway in front of Resend - can point this somewhere else without
   reaching into the module. */
const resendBase = () => (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '');
const RESEND_ENDPOINT = () => `${resendBase()}/emails`;
const DOMAINS_ENDPOINT = () => `${resendBase()}/domains`;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Default recipient for site notifications. */
function defaultTo() {
  return process.env.FORM_TO || process.env.CONTACT_NOTIFY_EMAIL || '';
}

/** Verified sender identity. */
function defaultFrom() {
  return process.env.FORM_FROM || process.env.NOTIFY_FROM || 'Rockfield National Bank <onboarding@resend.dev>';
}

/**
 * Send an email through Resend, reporting what came back.
 *
 * `headers` carries RFC 5322 headers such as In-Reply-To, which is what makes a
 * reply land inside the recipient's existing conversation rather than opening a
 * fresh one beside it.
 *
 * @param {{to?:string, from?:string, subject:string, text:string, replyTo?:string, headers?:object}} opts
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
async function send(opts) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = opts.to || defaultTo();
  if (!apiKey) return { ok: false, error: 'no_api_key' };
  if (!to) return { ok: false, error: 'no_recipient' };

  const payload = {
    from: opts.from || defaultFrom(),
    to: to.split(',').map((s) => s.trim()).filter(Boolean),
    subject: opts.subject,
    text: opts.text,
  };

  // The monospace block suits the machine-formatted notifications this started
  // out serving. A message written by a person should not arrive looking like a
  // log line, and a text-only mail also scores better with spam filters, so
  // `html: false` sends without an HTML part at all.
  // A caller that has written its own HTML part (the bank's alert templates do)
  // passes it through as a string; `false` sends text only.
  if (typeof opts.html === 'string' && opts.html.trim()) {
    payload.html = opts.html;
  } else if (opts.html !== false) {
    payload.html = `<pre style="font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(opts.text)}</pre>`;
  }
  if (opts.replyTo) payload.reply_to = opts.replyTo;
  if (opts.headers && Object.keys(opts.headers).length) payload.headers = opts.headers;

  try {
    const res = await fetch(RESEND_ENDPOINT(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn('[rockfield] notify email failed:', res.status, text);
      // Resend says why in the body - "The rockfield... domain is not
      // verified", "You can only send testing emails to your own address".
      // Dropping that and reporting a bare status code is what turns a
      // five-second fix into an afternoon.
      let detail = '';
      try { detail = JSON.parse(text).message || ''; } catch (e) { detail = String(text || '').slice(0, 200); }
      return { ok: false, error: `resend_${res.status}${detail ? `: ${detail}` : ''}`, status: res.status };
    }
    let id;
    try { id = JSON.parse(text).id; } catch (e) { /* id is a bonus, not a requirement */ }
    return { ok: true, id };
  } catch (err) {
    console.warn('[rockfield] notify email error:', err.message);
    return { ok: false, error: err.message };
  }
}

/** Fire-and-forget wrapper for callers that only care whether it left. */
async function sendEmail(opts) {
  const result = await send(opts);
  return result.ok;
}

async function sendWebhook(subject, text, data) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `${subject}\n\n${text}`, content: `${subject}\n\n${text}`, subject, data }),
    });
    if (!res.ok) console.warn('[rockfield] notify webhook failed:', res.status);
    return res.ok;
  } catch (err) {
    console.warn('[rockfield] notify webhook error:', err.message);
    return false;
  }
}

async function notify(subject, text, data, emailOpts = {}) {
  const results = await Promise.all([
    sendEmail({ subject, text, ...emailOpts }),
    sendWebhook(subject, text, data),
  ]);
  return results.some(Boolean);
}

/** A new contact-form enquiry. Replies go straight back to the sender. */
function enquiry(record) {
  const lines = [
    `Name:       ${record.name}`,
    `Email:      ${record.email}`,
    `Company:    ${record.company || '-'}`,
    `Discipline: ${record.service || '-'}`,
    '',
    record.message,
    '',
    `Received:   ${record.receivedAt}`,
    `Reference:  ${record.id}`,
  ].join('\n');
  return notify(`New enquiry from ${record.name}`, lines, record, { replyTo: record.email });
}

/** A job application from /careers. Replies go straight back to the applicant. */
function application(record) {
  const lines = [
    `Role:       ${record.roleTitle}`,
    `Name:       ${record.name}`,
    `Email:      ${record.email}`,
    `Phone:      ${record.phone || '-'}`,
    `Experience: ${record.experience || '-'}`,
    `Portfolio:  ${record.portfolio || '-'}`,
    '',
    record.message,
    '',
    `Received:   ${record.receivedAt}`,
    `Reference:  ${record.id}`,
  ].join('\n');
  return notify(`Application: ${record.roleTitle}`, lines, record, { replyTo: record.email });
}

/** A visitor message from the live chat. Set CHAT_NOTIFY=off to silence. */
function chatMessage(sessionId, text) {
  if (String(process.env.CHAT_NOTIFY || 'on').toLowerCase() === 'off') return Promise.resolve(false);
  const lines = [`Session: ${sessionId}`, '', text, '', `Received: ${new Date().toISOString()}`].join('\n');
  return notify('New live chat message', lines, { sessionId, text });
}

/**
 * What Resend holds for this account, and what it will do with it.
 *
 * A domain can be verified for sending and not for receiving - Resend calls
 * that `partially_verified` - which looks identical from the outside to
 * everything working, right up until somebody emails you. Asking the provider
 * is the only way to tell the difference, and it is one request.
 */
async function domains() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };
  try {
    const res = await fetch(DOMAINS_ENDPOINT(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.parse(text).message || ''; } catch (e) { detail = String(text || '').slice(0, 200); }
      return { ok: false, error: `resend_${res.status}${detail ? `: ${detail}` : ''}` };
    }
    const body = JSON.parse(text);
    const list = Array.isArray(body) ? body : (body.data || []);
    return {
      ok: true,
      domains: list.map((d) => ({
        name: d.name,
        status: d.status,
        region: d.region,
        sending: d.capabilities ? d.capabilities.sending : undefined,
        receiving: d.capabilities ? d.capabilities.receiving : undefined,
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { notify, send, sendEmail, enquiry, application, chatMessage, defaultTo, defaultFrom, domains };
