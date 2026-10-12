'use strict';

/**
 * Live chat, visitor side.
 *
 * Preferred path: the visitor is signed in anonymously and writes their own
 * rows to Supabase, so row level security grants them their own conversation
 * and nothing else. No token scheme of our own, no service key in the browser.
 * The desk answers from /admin and the reply appears here.
 *
 * Fallback path: when Supabase is not configured, POST /api/chat/message,
 * where the server holds the service role. Same conversation either way, so a
 * deployment can gain a database later without losing anything.
 */
(function () {
  const root = document.getElementById('chat');
  if (!root) return;

  const toggle = document.getElementById('chat-toggle');
  const panel = document.getElementById('chat-panel');
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const minBtn = document.getElementById('chat-min');

  const KEY_SESSION = 'rockfield_chat_supabase_session';
  const KEY_TOKEN = 'rockfield_chat_session';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const POLL_MS = 4000;
  const COLUMNS = 'id,created_at,sender,body';
  const GREETING = "Hi, you're through to Rockfield client services. How can we help? Please never send a password, a card number or a one-time code in chat.";

  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {}
    },
    drop(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    },
  };

  /* ------------------------------------------------------------- render --- */

  const seen = new Set();

  function bubble(role, text) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (role === 'agent' ? 'agent' : 'user');
    div.textContent = String(text == null ? '' : text);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function greet() {
    if (log.children.length === 0) bubble('agent', GREETING);
  }

  const senderOf = (row) => (row.sender || row.role) === 'agent' ? 'agent' : 'user';
  const textOf = (row) => (row.body != null ? row.body : row.text);

  /**
   * A row's identity. Supabase rows carry one; rows from the API are keyed on
   * their timestamp, parsed first because Postgres and JavaScript spell the
   * same instant differently and a raw string compare would draw it twice.
   */
  function keyOf(row) {
    if (row.id) return String(row.id);
    const at = row.at || row.created_at;
    return `${Date.parse(at) || at}|${textOf(row)}`;
  }

  /** Append rows we have not drawn yet, in order. */
  function draw(rows) {
    let drew = false;
    rows.forEach((row) => {
      const key = keyOf(row);
      if (seen.has(key)) return;
      seen.add(key);
      bubble(senderOf(row), textOf(row));
      drew = true;
    });
    return drew;
  }

  /* --------------------------------------------------------- transports --- */

  /* Rows straight to Supabase under the visitor's own anonymous identity. */
  function supabaseTransport(client) {
    let sessionId = null;

    const stored = store.get(KEY_SESSION);
    if (stored && UUID.test(stored)) sessionId = stored;

    async function ensureSession() {
      if (sessionId) return sessionId;
      const user = (await client.auth.signInAnonymously()).user;
      const rows = await client.insert('chat_sessions', { visitor_id: user && user.id }, 'id');
      sessionId = rows[0].id;
      store.set(KEY_SESSION, sessionId);
      return sessionId;
    }

    return {
      async open() {
        await client.auth.signInAnonymously();
        if (!sessionId) return [];
        // Readable only by its owner. If it has gone (row deleted, or this
        // browser lost the anonymous login it was created under), start over
        // rather than showing an empty shell.
        const rows = await client.select('chat_sessions', `select=id&id=eq.${sessionId}&limit=1`);
        if (!rows.length) {
          store.drop(KEY_SESSION);
          sessionId = null;
          return [];
        }
        return client.select(
          'chat_messages',
          `select=${COLUMNS}&session_id=eq.${sessionId}&order=created_at.asc&limit=200`
        );
      },

      async send(text) {
        const id = await ensureSession();
        const rows = await client.insert(
          'chat_messages',
          { session_id: id, sender: 'visitor', body: text },
          COLUMNS
        );
        // The desk hears about it, and the holding reply comes back from the
        // server, which is what knows whether a human has taken over.
        fetch('/api/chat/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: id, text }),
        }).catch(() => {});
        return rows;
      },

      async poll() {
        if (!sessionId) return [];
        return client.select(
          'chat_messages',
          `select=${COLUMNS}&session_id=eq.${sessionId}&order=created_at.asc&limit=200`
        );
      },
    };
  }

  /* Everything through the API, which holds the service role. */
  function serverTransport() {
    let token = store.get(KEY_TOKEN);
    if (!token || !/^[A-Za-z0-9_-]{8,64}$/.test(token)) {
      token = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(36).slice(2)).slice(0, 40);
      store.set(KEY_TOKEN, token);
    }

    const history = async () => {
      const res = await fetch(`/api/chat/${token}`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      return data.messages || [];
    };

    return {
      open: history,
      poll: history,
      async send(text) {
        const res = await fetch('/api/chat/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ sessionId: token, text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Send failed');
        return data.messages || [];
      },
    };
  }

  /* ---------------------------------------------------------- behaviour --- */

  let transport = null;
  let ready = null;
  let timer = null;

  async function connect() {
    if (ready) return ready;
    ready = (async () => {
      try {
        const res = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
        const cfg = await res.json();
        if (cfg.chatEnabled && window.MerkelSupabase) {
          const client = window.MerkelSupabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
            storageKey: 'rockfield-visitor-auth',
          });
          await client.auth.signInAnonymously();
          return supabaseTransport(client);
        }
      } catch (err) {
        // Most often anonymous sign-ins are switched off. The visitor should
        // not see that; the message says exactly where to fix it.
        console.warn('[rockfield] live chat falling back to the server:', err.message);
      }
      return serverTransport();
    })();
    transport = await ready;
    return transport;
  }

  async function refresh(first) {
    try {
      const t = await connect();
      const rows = await (first ? t.open() : t.poll());
      draw(rows);
      greet();
    } catch (err) {
      greet();
    }
  }

  function startPolling() {
    stopPolling();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh(false);
    }, POLL_MS);
  }

  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  let opened = false;

  function open() {
    root.classList.add('open');
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (!opened) {
      opened = true;
      refresh(true);
    }
    startPolling();
    setTimeout(() => input.focus(), 60);
  }

  function close() {
    root.classList.remove('open');
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    stopPolling();
  }

  toggle.addEventListener('click', () => (root.classList.contains('open') ? close() : open()));
  if (minBtn) minBtn.addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    try {
      const t = await connect();
      const rows = await t.send(text);
      draw(rows);

      // On the Supabase path only the visitor's own row comes back; the reply
      // is written by the server a moment later and arrives on the next read.
      if (!rows.some((row) => senderOf(row) === 'agent')) {
        const typing = document.createElement('div');
        typing.className = 'chat-msg agent typing';
        typing.textContent = 'Typing';
        log.appendChild(typing);
        log.scrollTop = log.scrollHeight;
        setTimeout(async () => {
          await refresh(false);
          typing.remove();
        }, 900);
      }
    } catch (err) {
      const inbox = (window.ROCKFIELD && window.ROCKFIELD.site.email) || 'client services';
      bubble('agent', `That message did not send. Please email ${inbox}.`);
    }
  });
})();
