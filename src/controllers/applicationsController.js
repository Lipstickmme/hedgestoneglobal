'use strict';

const crypto = require('crypto');
const storage = require('../utils/storage');
const notify = require('../utils/notify');
const roles = require('../data/careers.json');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(str, max) {
  return String(str == null ? '' : str).trim().slice(0, max);
}

/**
 * An application written as an enquiry, for a database that predates the
 * applications table. Everything the form collected survives; the discipline
 * field carries the marker the dashboard reads it back by.
 */
const APPLICATION_MARKER = 'Application: ';

function asEnquiry(record) {
  const lines = [
    record.experience ? `Years in practice: ${record.experience}` : null,
    record.phone ? `Phone: ${record.phone}` : null,
    record.portfolio ? `Portfolio: ${record.portfolio}` : null,
    '',
    record.message,
  ].filter((line) => line !== null);

  return {
    id: record.id,
    name: record.name,
    email: record.email,
    company: record.portfolio || null,
    service: `${APPLICATION_MARKER}${record.roleTitle}`,
    message: lines.join('\n'),
    receivedAt: record.receivedAt,
    ip: record.ip,
  };
}

/**
 * Write the application down, wherever it can go.
 *
 * The applications table arrives with 0001_init.sql, and a project set up
 * before that simply does not have it. Rather than accept the form, thank the
 * applicant and drop the row, fall back to the enquiries table, which every
 * deployment with a database already has. Returns where it landed.
 */
async function persist(record) {
  try {
    await storage.applications.append(record);
    return 'applications';
  } catch (err) {
    console.warn('[rockfield] applications table unavailable, filing as an enquiry:', err.message);
  }

  try {
    await storage.enquiries.append(asEnquiry(record));
    return 'enquiries';
  } catch (err) {
    console.error('[rockfield] failed to persist application:', err.message);
    return null;
  }
}

/**
 * POST /api/applications
 *
 * The apply link on /careers lands here. Same contract as the contact form:
 * validated, rate limited, persisted, and raised with the desk by email or
 * webhook, with persistence and notification both best effort so neither can
 * lose the other.
 */
exports.create = async (req, res, next) => {
  try {
    const name = clean(req.body.name, 120);
    const email = clean(req.body.email, 200);
    const phone = clean(req.body.phone, 60);
    const roleId = clean(req.body.roleId, 80);
    const portfolio = clean(req.body.portfolio, 400);
    const experience = clean(req.body.experience, 40);
    const message = clean(req.body.message, 4000);

    const errors = {};
    if (name.length < 2) errors.name = 'Please enter your name.';
    if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.';
    if (message.length < 20) errors.message = 'Tell us a little about the work you have done (20+ characters).';

    // The role is optional: a speculative application is still an application.
    const role = roles.find((r) => r.id === roleId);
    if (roleId && !role) errors.roleId = 'That role is no longer open.';

    if (Object.keys(errors).length) {
      return res.status(422).json({ error: 'validation_error', fields: errors });
    }

    const trap = clean(req.body.website, 200);

    const record = {
      id: crypto.randomUUID(),
      name,
      email,
      phone: phone || null,
      roleId: role ? role.id : null,
      roleTitle: role ? role.title : 'Speculative application',
      portfolio: portfolio || null,
      experience: experience || null,
      message,
      receivedAt: new Date().toISOString(),
      ip: req.ip || null,
    };

    let stored = null;
    if (!trap) {
      stored = await persist(record);
      await notify.application(record);
    }

    return res.status(201).json({
      ok: true,
      id: record.id,
      stored,
      message: 'Thank you. Your application is with our recruitment team and we will come back to you.',
    });
  } catch (err) {
    return next(err);
  }
};

exports.APPLICATION_MARKER = APPLICATION_MARKER;
