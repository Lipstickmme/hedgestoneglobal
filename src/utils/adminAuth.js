'use strict';

/**
 * Confirms a request carries the session of someone on the `admins` table.
 *
 * The dashboard otherwise reads and writes Supabase directly, where row level
 * security decides what each signed-in user may touch. Sending mail cannot work
 * that way: it needs the Resend key, which only the server holds. This route is
 * therefore the one place that has to re-establish server side what those
 * policies would have enforced. Without it the endpoint would let anyone on the
 * internet send mail as the bank.
 */

const config = require('./config');
const { getSupabase } = require('./supabase');

function bearerToken(headers) {
  const raw = (headers && (headers.authorization || headers.Authorization)) || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1].trim() : '';
}

/**
 * @returns {Promise<{ok: true, user: object}|{ok: false, status: number, reason: string}>}
 */
async function requireAdmin(req) {
  const token = bearerToken(req.headers);
  if (!token) return { ok: false, status: 401, reason: 'missing_token' };

  const url = config.supabaseUrl();
  const anonKey = config.supabaseAnonKey();
  const supabase = getSupabase();
  if (!url || !anonKey || !supabase) {
    return { ok: false, status: 503, reason: 'supabase_not_configured' };
  }

  // Supabase itself validates the signature and expiry; re-implementing that
  // here would be a second thing to keep correct as keys rotate.
  let user;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, status: 401, reason: 'invalid_token' };
    user = await res.json();
  } catch (err) {
    console.warn('[rockfield] admin auth unreachable:', err.message);
    return { ok: false, status: 503, reason: 'auth_unreachable' };
  }

  // Anonymous sessions are real sessions: the chat widget signs visitors in
  // with one, so a visitor holds a valid token and must not pass as staff.
  if (!user || !user.id || user.is_anonymous) {
    return { ok: false, status: 401, reason: 'invalid_token' };
  }

  const rows = await supabase.select(
    'admins',
    `select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
  );
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, status: 403, reason: 'not_an_admin' };
  }

  return { ok: true, user };
}

module.exports = { requireAdmin };
