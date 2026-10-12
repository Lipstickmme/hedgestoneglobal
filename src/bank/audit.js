'use strict';

/**
 * The activity log.
 *
 * Every authenticated action writes one row: who did it, to whom, from where
 * and what changed. Customers see their own security history; the admin
 * console sees all of it and can filter. It is the first thing anyone asks for
 * when a customer disputes something, so it is written on the way through
 * rather than reconstructed afterwards.
 *
 * Logging never throws into the request path: a failed write is reported to
 * the console and the original operation still completes.
 */

const { db } = require('./db');
const ids = require('./ids');

/** Enough of a user agent to recognise a device without parsing the world. */
function describeDevice(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari'
          : /Firefox\//.test(ua) ? 'Firefox'
            : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
      : /Mac OS X/.test(ua) ? 'macOS'
        : /Windows/.test(ua) ? 'Windows'
          : /Linux/.test(ua) ? 'Linux'
            : 'Unknown OS';
  const kind = /Mobile|iPhone|Android/.test(ua) ? 'Mobile' : /iPad|Tablet/.test(ua) ? 'Tablet' : 'Desktop';
  return { browser, os, kind, label: `${browser} on ${os}` };
}

function clientIp(req) {
  if (!req) return '';
  const fwd = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
}

/**
 * @param {object} entry
 * @param {string} entry.action  machine name, e.g. 'transfer.submitted'
 * @param {string} [entry.category] security | money | admin | account | session
 * @param {string} [entry.userId] the customer the entry is about
 * @param {object} [entry.actor] who performed it: { id, email, role }
 * @param {string} [entry.detail] one sentence, shown to the customer
 * @param {object} [entry.meta] anything structured worth keeping
 * @param {'info'|'notice'|'warning'|'critical'} [entry.severity]
 * @param {object} [entry.req] the Express request, for IP and user agent
 */
async function log(entry = {}) {
  try {
    const req = entry.req;
    const userAgent = (req && req.headers && req.headers['user-agent']) || entry.userAgent || '';
    const device = describeDevice(userAgent);
    const row = {
      id: ids.uuid(),
      created_at: new Date().toISOString(),
      user_id: entry.userId || (entry.actor && entry.actor.id) || null,
      actor_id: (entry.actor && entry.actor.id) || null,
      actor_email: (entry.actor && entry.actor.email) || null,
      actor_role: (entry.actor && entry.actor.role) || 'system',
      action: entry.action || 'unknown',
      category: entry.category || 'account',
      detail: entry.detail || '',
      severity: entry.severity || 'info',
      channel: entry.channel || 'web',
      ip: clientIp(req) || entry.ip || '',
      user_agent: userAgent,
      device: device.label,
      meta: entry.meta || null,
    };
    await db.activity.insert(row);
    return row;
  } catch (err) {
    console.warn('[rockfield] activity log failed:', err.message);
    return null;
  }
}

/** A customer's own history, newest first. */
function forUser(userId, limit = 100) {
  return db.activity.find({ user_id: userId }, { order: 'created_at.desc', limit });
}

module.exports = { log, forUser, describeDevice, clientIp };
