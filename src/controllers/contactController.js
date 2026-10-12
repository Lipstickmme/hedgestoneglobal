'use strict';

const crypto = require('crypto');
const storage = require('../utils/storage');
const notify = require('../utils/notify');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(str, max) {
  return String(str == null ? '' : str).trim().slice(0, max);
}

exports.create = async (req, res, next) => {
  try {
    const name = clean(req.body.name, 120);
    const email = clean(req.body.email, 200);
    const company = clean(req.body.company, 160);
    const service = clean(req.body.service, 60);
    const message = clean(req.body.message, 4000);

    const errors = {};
    if (name.length < 2) errors.name = 'Please enter your name.';
    if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.';
    if (message.length < 10) errors.message = 'Please tell us a little more (10+ characters).';

    // Honeypot: bots fill hidden fields. Silently accept, but drop.
    const trap = clean(req.body.website, 200);

    if (Object.keys(errors).length) {
      return res.status(422).json({ error: 'validation_error', fields: errors });
    }

    const record = {
      id: crypto.randomUUID(),
      name,
      email,
      company: company || null,
      service: service || null,
      message,
      receivedAt: new Date().toISOString(),
      ip: req.ip || null,
    };

    if (!trap) {
      // Persist first, then route to the inbox. Both are best effort so a
      // notification outage never loses the enquiry or fails the request.
      try {
        await storage.append(record);
      } catch (err) {
        console.error('[rockfield] failed to persist enquiry:', err.message);
      }
      await notify.enquiry(record);
    }

    return res.status(201).json({
      ok: true,
      id: record.id,
      message: 'Thank you. Your enquiry has reached our client services team.',
    });
  } catch (err) {
    return next(err);
  }
};
