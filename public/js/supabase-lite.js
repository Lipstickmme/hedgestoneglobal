'use strict';

/**
 * A small Supabase client: anonymous and password sign-in, token refresh, and
 * PostgREST reads and writes as the signed-in user.
 *
 * It exists instead of @supabase/supabase-js because this site has no bundler
 * and no runtime dependencies, and a page that cannot load a third-party CDN
 * should still be able to open a chat. The endpoints are the same ones the
 * official client calls, so row level security sees exactly the same request.
 *
 * The anon key it is constructed with is public by design: the policies are
 * what protect the data, not the secrecy of that key.
 */
(function (global) {
  function readError(body, res) {
    const msg =
      (body && (body.error_description || body.msg || body.message || body.error || body.hint)) ||
      `Request failed (${res.status})`;
    const err = new Error(String(msg));
    err.status = res.status;
    err.code = body && (body.error_code || body.code);
    return err;
  }

  async function parse(res) {
    const text = await res.text().catch(() => '');
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return { message: text };
    }
  }

  function createClient(url, anonKey, options) {
    const base = String(url || '').replace(/\/+$/, '');
    const storageKey = (options && options.storageKey) || 'merkel-auth';
    const listeners = [];

    let session = null;
    try {
      const raw = global.localStorage.getItem(storageKey);
      if (raw) session = JSON.parse(raw);
    } catch (e) {
      session = null;
    }

    function persist(next) {
      session = next;
      try {
        if (next) global.localStorage.setItem(storageKey, JSON.stringify(next));
        else global.localStorage.removeItem(storageKey);
      } catch (e) {
        /* private mode: the session simply does not survive a reload */
      }
      listeners.forEach((fn) => {
        try {
          fn(next);
        } catch (e) {}
      });
    }

    function adopt(payload) {
      if (!payload || !payload.access_token) return null;
      persist({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        // A minute of headroom, so a request never leaves with a token that
        // expires in flight.
        expires_at: Date.now() + Math.max(0, (payload.expires_in || 3600) - 60) * 1000,
        user: payload.user || null,
      });
      return session;
    }

    async function auth(path, body, token) {
      const res = await fetch(`${base}/auth/v1/${path}`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token || anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body || {}),
      });
      const data = await parse(res);
      if (!res.ok) throw readError(data, res);
      return data;
    }

    /** A valid access token, refreshed if the current one is close to expiry. */
    async function accessToken() {
      if (!session) return null;
      if (session.expires_at && Date.now() < session.expires_at) return session.access_token;
      if (!session.refresh_token) {
        persist(null);
        return null;
      }
      try {
        adopt(await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
        return session ? session.access_token : null;
      } catch (err) {
        persist(null);
        return null;
      }
    }

    async function rest(method, table, query, body, prefer) {
      const token = (await accessToken()) || anonKey;
      const headers = {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      if (prefer) headers.Prefer = prefer;
      const res = await fetch(`${base}/rest/v1/${table}${query ? `?${query}` : ''}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await parse(res);
      if (!res.ok) throw readError(data, res);
      return data;
    }

    return {
      url: base,

      auth: {
        session: () => session,
        user: () => (session && session.user) || null,
        accessToken,
        onChange(fn) {
          listeners.push(fn);
          return () => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          };
        },

        /** Visitors. Requires Authentication, Providers, Anonymous. */
        async signInAnonymously() {
          if (await accessToken()) return session;
          try {
            return adopt(await auth('signup', { data: {} }));
          } catch (err) {
            if (/anonymous/i.test(err.message) || err.code === 'anonymous_provider_disabled') {
              throw new Error(
                'Anonymous sign-ins are disabled on this Supabase project. Enable them under ' +
                  'Authentication, Providers, Anonymous, on the project shown as supabaseUrl at /api/health.'
              );
            }
            throw err;
          }
        },

        /** Staff. Accounts are created in the Supabase dashboard, not here. */
        async signInWithPassword(email, password) {
          return adopt(await auth('token?grant_type=password', { email, password }));
        },

        async signOut() {
          const token = session && session.access_token;
          persist(null);
          if (token) {
            try {
              await auth('logout', {}, token);
            } catch (e) {
              /* the local session is gone either way */
            }
          }
        },
      },

      select: (table, query) => rest('GET', table, query),
      insert: (table, rows, returning) =>
        rest('POST', table, returning ? `select=${returning}` : '', Array.isArray(rows) ? rows : [rows],
          returning ? 'return=representation' : 'return=minimal'),
      update: (table, query, patch) => rest('PATCH', table, query, patch, 'return=minimal'),
    };
  }

  global.MerkelSupabase = { createClient };
})(window);
