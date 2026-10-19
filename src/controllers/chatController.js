'use strict';

const chatStore = require('../utils/chatStore');
const notify = require('../utils/notify');
const settings = require('../bank/settings');
const { BANK } = require('../bank/constants');

/** The platform's name as staff have set it, for the canned replies. */
const platform = () => (settings.snapshot().bankName || '').trim() || BANK.name;

function clean(str, max) {
  return String(str == null ? '' : str).trim().slice(0, max);
}

// Lightweight rule-based responder. This is the seam where a real agent,
// a human hand-off, or a third-party desk (Intercom, etc.) would plug in.
function autoReply(text) {
  const t = text.toLowerCase();
  const has = (...words) => words.some((w) => t.includes(w));

  if (has('hello', 'hi ', 'hey', 'good morning', 'good afternoon') || t === 'hi') {
    return `Hi, you're through to ${platform()} support. How can we help? Please never send a password or a one-time code in chat.`;
  }
  if (has('career', 'job', 'hiring', 'vacancy', 'apply', 'position', 'role')) {
    return 'We hire across operations, risk and technology. Open roles are on our Careers page, or tell me which area interests you.';
  }
  if (has('bitcoin', 'btc', 'crypto', 'invest')) {
    return `${platform()} invests in Bitcoin only. You buy at the live price from $1, choose how long you plan to hold, and your dashboard shows the value since the day you bought and the time left to maturity. Bitcoin's price can fall as well as rise, so only invest what you can leave invested.`;
  }
  if (has('fee', 'charge', 'cost', 'price', 'rate', 'minimum')) {
    return 'Every fee we charge is on the Fees page. Buying and selling Bitcoin has no commission; you pay the live price shown when you confirm.';
  }
  if (has('open an account', 'open account', 'sign up', 'new account', 'apply for', 'get started', 'start investing')) {
    return 'Start at Start investing and tell us a little about yourself. Someone from our team verifies your identity, opens your account and comes back to you the same business day. You will need a government ID.';
  }
  if (has('lost', 'stolen', 'fraud', 'unauthorised', 'unauthorized', 'scam', 'dispute', 'suspicious')) {
    return 'If you think your account has been compromised, do not wait on chat: use the details on the Security centre page. You can also sign every device out yourself under Security once you are signed in.';
  }
  if (has('password', 'locked', 'log in', 'login', 'sign in', 'signin', 'code', 'access')) {
    return `You can reset a password from the sign-in page under "Forgotten your password?". We will email a one-time code. Never share that code with anyone, including anyone claiming to be from ${platform()}.`;
  }
  if (has('withdraw', 'transfer', 'payment', 'deposit', 'balance', 'account', 'maturity', 'matures')) {
    return 'Someone from our team can go through that with you. Leave your email here and what it is about - never a password or a full account number - and we will come back to you the same business day.';
  }
  if (has('contact', 'call', 'phone', 'email', 'meet', 'speak', 'hours')) {
    return 'The fastest route is the Support page, where our number and hours are listed. Leave your email here and someone from our team will come back to you the same business day.';
  }
  if (has('thanks', 'thank you', 'cheers', 'great')) {
    return 'Any time. Anything else I can help with?';
  }
  return "Thanks for the message. Someone from our team will follow up. If you leave your email and a line about what you need, we'll route it to the right person.";
}

/**
 * POST /api/chat/message
 *
 * Fallback path: used when the browser cannot reach Supabase itself (not
 * configured, or the client library failed to load). The server holds the
 * service role, so it writes both sides of the exchange.
 */
exports.postMessage = async (req, res, next) => {
  try {
    const sessionId = clean(req.body.sessionId, 64);
    const text = clean(req.body.text, 2000);

    if (!chatStore.isValidId(sessionId)) {
      return res.status(422).json({ error: 'invalid_session', message: 'Missing or malformed session id.' });
    }
    if (text.length < 1) {
      return res.status(422).json({ error: 'empty_message', message: 'Message cannot be empty.' });
    }

    const now = new Date().toISOString();
    const messages = [{ role: 'user', text, at: now }];

    // Stay quiet once a representative has picked the conversation up.
    let handedOver = false;
    try {
      handedOver = await chatStore.isHandedOver(sessionId);
    } catch (err) {
      console.error('[hedgestone] chat handover check failed:', err.message);
    }

    const reply = handedOver ? null : { role: 'agent', text: autoReply(text), at: new Date(Date.now() + 1).toISOString() };
    if (reply) messages.push(reply);

    let stored = true;
    try {
      await chatStore.append(sessionId, messages);
    } catch (err) {
      stored = false;
      console.error('[hedgestone] failed to persist chat message:', err.message);
    }

    // Route the visitor's message to the inbox so a human can pick it up.
    await notify.chatMessage(chatStore.sessionUuid(sessionId), text);

    // Both sides come back, so the widget draws the visitor's own message from
    // the same source it draws everything else and cannot double it up.
    return res.status(201).json({ ok: true, stored, messages });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/chat/notify
 *
 * Companion to the browser-written path. The visitor's own message is already
 * in the database, written by their browser under row level security; this
 * raises the flag by email and, until a human takes over, posts the holding
 * reply with the service role so it reaches them over realtime.
 */
exports.notifyMessage = async (req, res, next) => {
  try {
    const sessionId = clean(req.body.sessionId, 64);
    const text = clean(req.body.text, 2000);

    if (!chatStore.isUuid(sessionId)) {
      return res.status(422).json({ error: 'invalid_session', message: 'Missing or malformed session id.' });
    }
    if (text.length < 1) {
      return res.status(422).json({ error: 'empty_message', message: 'Message cannot be empty.' });
    }

    let replied = false;
    try {
      if (!(await chatStore.isHandedOverById(sessionId))) {
        await chatStore.appendById(sessionId, [{ role: 'agent', text: autoReply(text), at: new Date().toISOString() }]);
        replied = true;
      }
    } catch (err) {
      console.error('[hedgestone] failed to post chat reply:', err.message);
    }

    await notify.chatMessage(sessionId, text);

    return res.status(202).json({ ok: true, replied });
  } catch (err) {
    return next(err);
  }
};

/** GET /api/chat/:sessionId */
exports.getHistory = async (req, res, next) => {
  try {
    const sessionId = clean(req.params.sessionId, 64);
    if (!chatStore.isValidId(sessionId)) {
      return res.status(422).json({ error: 'invalid_session', message: 'Malformed session id.' });
    }
    let convo = { messages: [] };
    try {
      convo = await chatStore.load(sessionId);
    } catch (err) {
      // A storage fault should cost the visitor their history, not the widget.
      console.error('[hedgestone] failed to load chat history:', err.message);
    }
    return res.json({ sessionId, messages: convo.messages });
  } catch (err) {
    return next(err);
  }
};
