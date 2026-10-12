'use strict';

/**
 * Inbound email webhook.
 *
 * Resend (or any Svix-signed provider) POSTs here when mail arrives at
 * MAILBOX_ADDRESS. Verified messages are filed onto a thread so the dashboard
 * reads them as one conversation, and optionally copied to FORWARD_TO.
 */

const { verify } = require('../utils/webhookSignature');
const notify = require('../utils/notify');
const config = require('../utils/config');
const { getSupabase } = require('../utils/supabase');

function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length) {
      const found = v.map((x) => (typeof x === 'string' ? x : x && (x.address || x.email))).filter(Boolean);
      if (found.length) return found.join(', ');
    }
  }
  return '';
}

/** Providers differ in payload shape, so pull fields defensively. */
function parseEmail(payload) {
  const d = (payload && (payload.data || payload.email || payload)) || {};
  return {
    messageId: firstString(d.message_id, d.messageId, d.id, payload && payload.id),
    // The provider's own handle for the message, which is how the body is
    // retrieved when the webhook does not carry one.
    emailId: firstString(d.email_id, d.emailId),
    inReplyTo: firstString(d.in_reply_to, d.inReplyTo, d.references),
    from: firstString(d.from, d.sender, d.From),
    to: firstString(d.to, d.recipient, d.To),
    subject: firstString(d.subject, d.Subject) || '(no subject)',
    text: firstString(d.text, d.body_plain, d.plain, d.body),
    html: firstString(d.html, d.body_html),
  };
}

/**
 * Fetch a message body the webhook did not carry.
 *
 * Resend's email.received payload lists the envelope -- sender, recipients,
 * subject, attachments -- but no text or html part, so a message filed straight
 * from the webhook reads as empty in the dashboard. The body has to be asked
 * for by id. Best effort: a conversation with a subject and a sender is still
 * worth keeping if this fails.
 */
async function fetchBody(emailId) {
  const apiKey = config.resendApiKey();
  if (!apiKey || !emailId) return null;

  try {
    // Received mail is a separate collection from sent: /emails/{id} answers
    // "Email not found" for an inbound id.
    //
    // html_format=cid leaves inline images as cid: references to the
    // attachments rather than expanding them into base64 data URIs, which keeps
    // a photo signature from turning one row into megabytes.
    const res = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      // The response text names which of these it is: a wrong path, a key
      // without inbound scope, or an id this account cannot read.
      console.warn('[rockfield] could not fetch inbound body:', res.status, raw.slice(0, 300));
      return null;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn('[rockfield] inbound body was not json:', raw.slice(0, 200));
      return null;
    }
    const text = firstString(data.text, data.body_plain, data.plain);
    const html = firstString(data.html, data.body_html);
    return text || html ? { text, html } : null;
  } catch (err) {
    console.warn('[rockfield] inbound body fetch error:', err.message);
    return null;
  }
}

/** Threads match on correspondent plus subject, so strip reply prefixes. */
function baseSubject(subject) {
  return String(subject || '')
    .replace(/^((re|fwd|fw)\s*:\s*)+/i, '')
    .trim() || '(no subject)';
}

/** File the message onto a thread, creating one if needed. Best effort. */
async function fileOnThread(supabase, email) {
  const from = config.parseAddress(email.from);
  const subject = baseSubject(email.subject);

  let threadId = null;
  const existing = await supabase.select(
    'email_threads',
    `select=id&participant_email=eq.${encodeURIComponent(from.email)}` +
      `&subject=eq.${encodeURIComponent(subject)}&limit=1`
  );
  if (Array.isArray(existing) && existing.length) {
    threadId = existing[0].id;
  } else {
    const created = await supabase.insertReturning('email_threads', {
      subject,
      participant_email: from.email,
      participant_name: from.name || null,
    });
    threadId = Array.isArray(created) && created.length ? created[0].id : null;
  }

  if (!threadId) return null;

  await supabase.insert('email_messages', {
    thread_id: threadId,
    direction: 'inbound',
    from_email: from.email,
    from_name: from.name || null,
    to_email: config.parseAddress(email.to).email || config.mailboxAddress(),
    subject: email.subject,
    body_text: email.text || null,
    body_html: email.html || null,
    message_id: email.messageId || null,
    in_reply_to: email.inReplyTo || null,
  });
  return threadId;
}

exports.resend = async (req, res, next) => {
  try {
    const secret = config.resendWebhookSecret();

    // Only accept signed requests. Without a secret the endpoint stays closed.
    const result = verify(secret, req.headers, req.rawBody);
    if (!result.ok) {
      console.warn('[rockfield] inbound webhook rejected:', result.reason);
      // The reason is returned, not just logged: a provider's delivery log is
      // where this failure is actually read, and a bare 401 there is
      // indistinguishable between an unset secret, a mismatched one, and a
      // provider that never sent the headers. It tells a caller nothing they
      // did not already know from the status code.
      return res.status(401).json({
        error: 'invalid_signature',
        reason: result.reason,
        message: 'Webhook signature could not be verified.',
      });
    }

    const payload = req.body || {};
    const type = String(payload.type || payload.event || '');

    // Delivery/status events are acknowledged but need no action.
    if (type && !/received|inbound/i.test(type)) {
      return res.status(200).json({ ok: true, ignored: type });
    }

    const email = parseEmail(payload);
    const mailbox = config.mailboxAddress();
    if (mailbox && email.to && !email.to.toLowerCase().includes(config.parseAddress(mailbox).email)) {
      return res.status(200).json({ ok: true, ignored: 'not_for_mailbox' });
    }

    if (!email.text && !email.html) {
      const fetched = await fetchBody(email.emailId);
      if (fetched) {
        email.text = fetched.text;
        email.html = fetched.html;
      }
    }

    // Archive onto a thread (best effort; never fails the webhook).
    let threadId = null;
    const supabase = getSupabase();
    if (supabase) {
      try {
        threadId = await fileOnThread(supabase, email);
      } catch (err) {
        console.error('[rockfield] failed to file inbound email:', err.message);
      }
    }

    // Optional copy to a real inbox. Never forward to one of our own
    // addresses, and never forward mail we sent: either loops the message
    // straight back into this webhook until the sending quota is gone.
    const forwardTo = config.forwardTo();
    const ours = config.ownAddresses();
    const fromAddress = config.parseAddress(email.from).email;
    let forwarded = false;

    if (forwardTo && (config.forwardWouldLoop() || ours.has(fromAddress))) {
      console.warn(
        '[rockfield] not forwarding: FORWARD_TO or the sender is one of this site\'s own addresses, which would loop mail back into this webhook.'
      );
    } else if (forwardTo) {
      const body = [
        `From:    ${email.from || 'unknown'}`,
        `To:      ${email.to || mailbox || 'unknown'}`,
        `Subject: ${email.subject}`,
        '',
        email.text || '(no body)',
      ].join('\n');

      forwarded = await notify.sendEmail({
        to: forwardTo,
        subject: `Fwd: ${email.subject}`,
        text: body,
        replyTo: email.from || undefined,
      });
    }

    return res.status(200).json({ ok: true, threadId, forwarded });
  } catch (err) {
    return next(err);
  }
};
