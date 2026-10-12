'use strict';

/**
 * Replying to bank mail from the dashboard.
 *
 * The rest of the dashboard writes to Supabase straight from the browser, but a
 * reply has to leave through Resend, whose key is server-only. So this is a
 * route rather than a direct table write, and it checks admin membership itself
 * before doing anything.
 */

const config = require('../utils/config');
const notify = require('../utils/notify');
const { requireAdmin } = require('../utils/adminAuth');
const { getSupabase } = require('../utils/supabase');

const MAX_BODY = 20000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The From header for a reply, always carrying a display name.
 *
 * Mail clients fall back to the local part of the address when there is none,
 * so a reply from support@rockfieldglobalfinance.com shows in the recipient's
 * inbox as "contact" rather than the bank's name.
 */
function senderIdentity() {
  const configured = config.mailboxAddress() || config.formFrom();
  const { name, email } = config.parseAddress(configured);
  if (!email) return configured;
  return name ? configured : `${config.senderName()} <${email}>`;
}

/** Keep one "Re: " on the front, however the subject arrived. */
function replySubject(subject) {
  const base = String(subject || '').replace(/^((re|fwd|fw)\s*:\s*)+/i, '').trim();
  return base ? `Re: ${base}` : 'Re: your message';
}

exports.reply = async (req, res, next) => {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.reason, message: 'Sign in as an admin to reply.' });
    }

    const threadId = String((req.body && req.body.threadId) || '').trim();
    const body = String((req.body && req.body.body) || '').trim();

    if (!UUID.test(threadId)) {
      return res.status(422).json({ error: 'invalid_thread', message: 'threadId must be a thread uuid.' });
    }
    if (!body) {
      return res.status(422).json({ error: 'empty_body', message: 'A reply needs some text.' });
    }
    if (body.length > MAX_BODY) {
      return res.status(422).json({ error: 'body_too_long', message: `Replies are limited to ${MAX_BODY} characters.` });
    }

    const supabase = getSupabase();
    if (!supabase) {
      return res.status(503).json({ error: 'no_storage', message: 'Supabase is not configured.' });
    }

    const threads = await supabase.select(
      'email_threads',
      `select=id,subject,participant_email&id=eq.${encodeURIComponent(threadId)}&limit=1`
    );
    if (!Array.isArray(threads) || !threads.length) {
      return res.status(404).json({ error: 'no_thread', message: 'That conversation no longer exists.' });
    }
    const thread = threads[0];

    // Threading the reply onto the correspondent's last message is what puts it
    // inside their existing conversation instead of starting a new one.
    let inReplyTo = null;
    const previous = await supabase.select(
      'email_messages',
      `select=message_id&thread_id=eq.${encodeURIComponent(threadId)}&direction=eq.inbound` +
        '&order=created_at.desc&limit=1'
    );
    if (Array.isArray(previous) && previous.length) inReplyTo = previous[0].message_id || null;

    const from = senderIdentity();
    const subject = replySubject(thread.subject);

    const sent = await notify.send({
      to: thread.participant_email,
      from,
      subject,
      text: body,
      // Written by a person, so it goes as plain text rather than the monospace
      // block the automated notifications use.
      html: false,
      headers: inReplyTo ? { 'In-Reply-To': inReplyTo, References: inReplyTo } : undefined,
    });

    if (!sent.ok) {
      return res.status(502).json({
        error: 'send_failed',
        reason: sent.error,
        message: 'Resend would not accept the reply. Check RESEND_API_KEY and that FORM_FROM is on a verified domain.',
      });
    }

    // Recorded after a confirmed send, so the thread never shows a reply that
    // did not leave.
    await supabase.insert('email_messages', {
      thread_id: threadId,
      direction: 'outbound',
      from_email: config.parseAddress(from).email,
      from_name: config.parseAddress(from).name || null,
      to_email: thread.participant_email,
      subject,
      body_text: body,
      message_id: sent.id || null,
      in_reply_to: inReplyTo,
    });

    return res.status(201).json({ ok: true, threadId, messageId: sent.id || null });
  } catch (err) {
    return next(err);
  }
};
