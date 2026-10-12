'use strict';

/**
 * Client services desk: the staff side of enquiries, live chat and mail.
 *
 * Everything on this page is read and written straight from the browser as
 * the signed-in user, so the policies in supabase/migrations decide what is
 * visible rather than a server route we would otherwise have to write and
 * protect twice. Being on the `admins` table is what grants it; revoking
 * someone is a row delete and takes effect on their next request.
 */
(function () {
  const POLL_MS = 5000;

  const $ = (id) => document.getElementById(id);
  const screens = {
    boot: $('admin-boot'),
    unconfigured: $('admin-unconfigured'),
    login: $('admin-login'),
    shell: $('admin-shell'),
  };

  function show(name) {
    Object.keys(screens).forEach((key) => {
      if (screens[key]) screens[key].hidden = key !== name;
    });
  }

  /** True while the cursor is in any field on the page. */
  function isTyping() {
    const node = document.activeElement;
    if (!node) return false;
    return node.tagName === 'TEXTAREA' || node.tagName === 'INPUT' || node.isContentEditable === true;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function when(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function alertBar(message) {
    const bar = $('admin-alert');
    if (!bar) return;
    bar.textContent = message || '';
    bar.hidden = !message;
  }

  /* ------------------------------------------------------------- state --- */

  let client = null;
  const state = {
    tab: 'enquiries',
    enquiries: [],
    applications: [],
    applicationsSource: 'applications',
    sessions: [],
    threads: [],
    active: { enquiries: null, applications: null, chat: null, email: null },
    messages: [],
    mail: [],
    emailAvailable: true,
    settings: null,
    effective: null,
    drafts: {},
    settingsEditable: true,
  };

  const STATUSES = [
    ['new', 'New'],
    ['in_progress', 'In progress'],
    ['closed', 'Closed'],
  ];

  /* ------------------------------------------------------------ queries --- */

  const loadEnquiries = () =>
    client.select('enquiries', 'select=*&order=created_at.desc&limit=200');

  // Applications filed as enquiries carry this in their discipline field.
  const APPLICATION_MARKER = 'Application: ';

  /**
   * Applications, from wherever they landed.
   *
   * A database created before the applications table existed takes them in
   * `enquiries` instead, so read that back rather than showing an empty tab
   * and losing sight of people who applied.
   */
  async function loadApplications() {
    try {
      const rows = await client.select('applications', 'select=*&order=created_at.desc&limit=200');
      state.applicationsSource = 'applications';
      return rows;
    } catch (err) {
      const rows = await client.select(
        'enquiries',
        `select=*&service=like.${encodeURIComponent(APPLICATION_MARKER)}*&order=created_at.desc&limit=200`
      );
      state.applicationsSource = 'enquiries';
      return rows.map((row) => ({
        id: row.id,
        created_at: row.created_at,
        name: row.name,
        email: row.email,
        phone: null,
        role_title: String(row.service || '').slice(APPLICATION_MARKER.length) || 'Speculative application',
        portfolio: row.company,
        experience: null,
        message: row.message,
        status: row.status,
      }));
    }
  }

  const loadSessions = () =>
    client.select('chat_sessions', 'select=*&order=last_message_at.desc&limit=200');

  const loadMessages = (id) =>
    client.select(
      'chat_messages',
      `select=id,created_at,sender,body&session_id=eq.${id}&order=created_at.asc&limit=500`
    );

  const loadThreads = () =>
    client.select('email_threads', 'select=*&order=last_message_at.desc&limit=200');

  const loadMail = (id) =>
    client.select(
      'email_messages',
      `select=id,created_at,direction,from_email,from_name,to_email,subject,body_text&thread_id=eq.${id}&order=created_at.asc&limit=200`
    );

  /* ------------------------------------------------------------ render --- */

  function tallies() {
    const counts = {
      enquiries: state.enquiries.filter((r) => r.status === 'new').length,
      applications: state.applications.filter((r) => r.status === 'new').length,
      chat: state.sessions.filter((r) => r.status === 'new').length,
      email: state.threads.filter((r) => r.status === 'new').length,
    };
    document.querySelectorAll('[data-tally]').forEach((node) => {
      const key = node.getAttribute('data-tally');
      node.textContent = counts[key];
      node.classList.toggle('is-live', counts[key] > 0);
    });
  }

  function listRow({ id, title, sub, meta, status, activeId, onPick }) {
    const li = el('li');
    const btn = el('button', 'admin-row' + (id === activeId ? ' is-active' : ''));
    btn.type = 'button';

    const head = el('div', 'admin-row-head');
    head.appendChild(el('span', 'admin-row-title', title));
    if (status === 'new') head.appendChild(el('span', 'admin-dot'));
    btn.appendChild(head);
    btn.appendChild(el('span', 'admin-row-sub', sub));
    btn.appendChild(el('span', 'admin-row-meta', meta));

    btn.addEventListener('click', onPick);
    li.appendChild(btn);
    return li;
  }

  function fill(list, rows, empty) {
    list.textContent = '';
    if (!rows.length) {
      list.appendChild(el('li', 'admin-empty', empty));
      return;
    }
    rows.forEach((row) => list.appendChild(row));
  }

  function statusPicker(current, onChange) {
    const wrap = el('div', 'admin-status');
    wrap.appendChild(el('span', 'k', 'Status'));
    const select = el('select');
    STATUSES.forEach(([value, label]) => {
      const option = el('option', null, label);
      option.value = value;
      if (value === current) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
  }

  function renderEnquiries() {
    const list = $('enquiry-list');
    fill(
      list,
      state.enquiries.map((row) =>
        listRow({
          id: row.id,
          title: row.name || 'Enquiry',
          sub: row.email || '',
          meta: when(row.created_at),
          status: row.status,
          activeId: state.active.enquiries,
          onPick: () => {
            state.active.enquiries = row.id;
            renderEnquiries();
          },
        })
      ),
      'No enquiries yet. The contact form opens them.'
    );

    const detail = $('enquiry-detail');
    const row = state.enquiries.find((r) => r.id === state.active.enquiries);
    detail.textContent = '';
    if (!row) {
      detail.appendChild(el('p', 'admin-empty', 'Pick an enquiry to read it.'));
      return;
    }

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, row.name || 'Enquiry'));
    head.appendChild(
      statusPicker(row.status, async (status) => {
        try {
          await client.update('enquiries', `id=eq.${row.id}`, { status });
          row.status = status;
          renderEnquiries();
          tallies();
        } catch (err) {
          alertBar(err.message);
        }
      })
    );
    detail.appendChild(head);

    const facts = el('dl', 'admin-facts');
    const fact = (k, v, href) => {
      if (!v) return;
      facts.appendChild(el('dt', null, k));
      const dd = el('dd');
      if (href) {
        const a = el('a', null, v);
        a.href = href;
        dd.appendChild(a);
      } else {
        dd.textContent = v;
      }
      facts.appendChild(dd);
    };
    fact('Email', row.email, `mailto:${row.email}?subject=${encodeURIComponent('Re: your message to Rockfield National Bank')}`);
    fact('Company', row.company);
    fact('Discipline', row.service);
    fact('Received', when(row.created_at));
    detail.appendChild(facts);

    detail.appendChild(el('p', 'admin-message', row.message));
  }

  function renderApplications() {
    const list = $('application-list');
    fill(
      list,
      state.applications.map((row) =>
        listRow({
          id: row.id,
          title: row.name || 'Applicant',
          sub: row.role_title || 'Speculative application',
          meta: when(row.created_at),
          status: row.status,
          activeId: state.active.applications,
          onPick: () => {
            state.active.applications = row.id;
            renderApplications();
          },
        })
      ),
      'No applications yet. The apply form on /careers opens them.'
    );

    if (state.applicationsSource === 'enquiries' && state.applications.length) {
      const note = el('li', 'admin-empty',
        'These arrived before this database had an applications table, so they are filed as enquiries. Run supabase/migrations/0001_init.sql to give them their own table; nothing already here is lost.');
      list.appendChild(note);
    }

    const detail = $('application-detail');
    const row = state.applications.find((r) => r.id === state.active.applications);
    detail.textContent = '';
    if (!row) {
      detail.appendChild(el('p', 'admin-empty', 'Pick an application to read it.'));
      return;
    }

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, row.name || 'Applicant'));
    head.appendChild(
      statusPicker(row.status, async (status) => {
        try {
          await client.update(state.applicationsSource, `id=eq.${row.id}`, { status });
          row.status = status;
          renderApplications();
          tallies();
        } catch (err) {
          alertBar(err.message);
        }
      })
    );
    detail.appendChild(head);

    const facts = el('dl', 'admin-facts');
    const fact = (k, v, href) => {
      if (!v) return;
      facts.appendChild(el('dt', null, k));
      const dd = el('dd');
      if (href) {
        const a = el('a', null, v);
        a.href = href;
        if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        dd.appendChild(a);
      } else {
        dd.textContent = v;
      }
      facts.appendChild(dd);
    };
    fact('Role', row.role_title);
    fact('Email', row.email, `mailto:${row.email}?subject=${encodeURIComponent(`Your application: ${row.role_title || 'Rockfield National Bank'}`)}`);
    fact('Phone', row.phone, row.phone ? `tel:${row.phone}` : null);
    fact('Experience', row.experience);
    fact('Portfolio', row.portfolio, row.portfolio);
    fact('Received', when(row.created_at));
    detail.appendChild(facts);

    detail.appendChild(el('p', 'admin-message', row.message));
  }

  function renderChat() {
    const list = $('chat-list');
    fill(
      list,
      state.sessions.map((row) =>
        listRow({
          id: row.id,
          title: row.visitor_name || 'Website visitor',
          sub: row.visitor_email || 'No email left',
          meta: when(row.last_message_at),
          status: row.status,
          activeId: state.active.chat,
          onPick: () => {
            state.active.chat = row.id;
            state.messages = [];
            renderChat();
            refreshThread();
          },
        })
      ),
      'No conversations yet. The widget on the public site opens them.'
    );

    const detail = $('chat-detail');
    const row = state.sessions.find((r) => r.id === state.active.chat);
    detail.textContent = '';
    if (!row) {
      detail.appendChild(el('p', 'admin-empty', 'Pick a conversation to read and reply.'));
      return;
    }

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, row.visitor_name || 'Website visitor'));
    head.appendChild(
      statusPicker(row.status, async (status) => {
        try {
          await client.update('chat_sessions', `id=eq.${row.id}`, { status });
          row.status = status;
          renderChat();
          tallies();
        } catch (err) {
          alertBar(err.message);
        }
      })
    );
    detail.appendChild(head);
    detail.appendChild(el('p', 'admin-sub', `Opened ${when(row.created_at)}`));

    const thread = el('ol', 'admin-thread');
    state.messages.forEach((message) => {
      const li = el('li', 'admin-bubble ' + (message.sender === 'agent' ? 'agent' : 'visitor'));
      li.appendChild(el('p', null, message.body));
      li.appendChild(el('time', null, when(message.created_at)));
      thread.appendChild(li);
    });
    detail.appendChild(thread);
    thread.scrollTop = thread.scrollHeight;

    const form = el('form', 'admin-reply');
    const box = el('textarea');
    box.rows = 2;
    box.placeholder = 'Type a reply';
    box.setAttribute('aria-label', 'Reply');
    // Survives a re-render from any other source, per conversation.
    box.value = state.drafts[row.id] || '';
    box.addEventListener('input', () => {
      state.drafts[row.id] = box.value;
    });
    const send = el('button', 'btn', 'Send');
    send.type = 'submit';
    form.appendChild(box);
    form.appendChild(send);

    const submit = async (event) => {
      if (event) event.preventDefault();
      const body = box.value.trim();
      if (!body) return;
      box.value = '';
      delete state.drafts[row.id];
      send.disabled = true;
      try {
        const rows = await client.insert(
          'chat_messages',
          { session_id: row.id, sender: 'agent', body },
          'id,created_at,sender,body'
        );
        state.messages = state.messages.concat(rows);
        // `handled_by_agent` is what stops the canned responder answering over
        // the top of a real person.
        try {
          await client.update('chat_sessions', `id=eq.${row.id}`, {
            status: 'in_progress',
            handled_by_agent: true,
          });
        } catch (err) {
          await client.update('chat_sessions', `id=eq.${row.id}`, { status: 'in_progress' });
          alertBar('Reply sent. Re-run supabase/migrations/0001_init.sql to add handled_by_agent, or the automatic responder keeps answering.');
        }
        row.status = 'in_progress';
        renderChat();
        tallies();
      } catch (err) {
        box.value = body;
        state.drafts[row.id] = body;
        alertBar(err.message);
      } finally {
        send.disabled = false;
      }
    };

    form.addEventListener('submit', submit);
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    detail.appendChild(form);
  }

  function renderEmail() {
    const list = $('email-list');
    if (!state.emailAvailable) {
      fill(list, [], 'Mail is not set up. Run supabase/migrations/0002_email.sql and point Resend Inbound at /api/inbound/resend.');
      $('email-detail').textContent = '';
      return;
    }

    fill(
      list,
      state.threads.map((row) =>
        listRow({
          id: row.id,
          title: row.participant_name || row.participant_email,
          sub: row.subject,
          meta: when(row.last_message_at),
          status: row.status,
          activeId: state.active.email,
          onPick: () => {
            state.active.email = row.id;
            state.mail = [];
            renderEmail();
            refreshThread();
          },
        })
      ),
      'No mail yet.'
    );

    const detail = $('email-detail');
    const row = state.threads.find((r) => r.id === state.active.email);
    detail.textContent = '';
    if (!row) {
      detail.appendChild(el('p', 'admin-empty', 'Pick a thread to read it.'));
      return;
    }

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, row.subject || '(no subject)'));
    head.appendChild(
      statusPicker(row.status, async (status) => {
        try {
          await client.update('email_threads', `id=eq.${row.id}`, { status });
          row.status = status;
          renderEmail();
          tallies();
        } catch (err) {
          alertBar(err.message);
        }
      })
    );
    detail.appendChild(head);

    detail.appendChild(el('p', 'admin-sub', `Conversation with ${row.participant_email}`));

    const thread = el('ol', 'admin-thread');
    state.mail.forEach((message) => {
      const li = el('li', 'admin-bubble ' + (message.direction === 'outbound' ? 'agent' : 'visitor'));
      li.appendChild(el('p', null, message.body_text || '(no text part)'));
      li.appendChild(el('time', null, `${message.from_email} · ${when(message.created_at)}`));
      thread.appendChild(li);
    });
    detail.appendChild(thread);
    thread.scrollTop = thread.scrollHeight;

    const form = el('form', 'admin-reply');
    const box = el('textarea');
    box.rows = 3;
    box.placeholder = `Reply to ${row.participant_email}`;
    box.setAttribute('aria-label', 'Reply');
    box.value = state.drafts[row.id] || '';
    box.addEventListener('input', () => {
      state.drafts[row.id] = box.value;
    });
    const send = el('button', 'btn', 'Send reply');
    send.type = 'submit';
    form.appendChild(box);
    form.appendChild(send);
    detail.appendChild(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = box.value.trim();
      if (!body) return;
      send.disabled = true;
      try {
        // The one part of this page that goes through the API: sending needs the
        // Resend key, which the browser must never hold.
        const token = await client.auth.accessToken();
        const res = await fetch('/api/emails/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ threadId: row.id, body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `Reply failed (${res.status})`);
        box.value = '';
        delete state.drafts[row.id];
        alertBar('');
        await refreshThread();
      } catch (err) {
        // The draft stays in the box, so a failed send is not lost text.
        alertBar(err.message);
      } finally {
        send.disabled = false;
      }
    });
  }

  /* ---------------------------------------------------------- settings --- */

  const SETTINGS_FIELDS = [
    ['address', 'Mailing address', 'text'],
    ['email', 'Email', 'email'],
    ['phone', 'Telephone', 'tel'],
    ['hours', 'Opening hours', 'text'],
  ];

  async function loadSettings() {
    // What the site is actually serving right now, stored value or built-in.
    try {
      state.effective = await (await fetch('/api/site', { headers: { Accept: 'application/json' } })).json();
    } catch (err) {
      state.effective = {};
    }
    try {
      const rows = await client.select('site_settings', 'select=*&id=eq.default&limit=1');
      state.settingsEditable = true;
      state.settings = rows[0] || {};
    } catch (err) {
      // The table arrives with 0001_init.sql. Without it the site keeps the
      // details it was built with; they just cannot be changed from here.
      state.settingsEditable = false;
      state.settings = null;
    }
  }

  function renderSettings() {
    const panel = $('settings-panel');
    // Built once. Rebuilding it would discard whatever is half typed and put
    // the stored values back in the boxes.
    if (panel.dataset.built === '1') return;
    panel.dataset.built = '1';
    panel.textContent = '';

    const head = el('div', 'admin-detail-head');
    head.appendChild(el('h2', null, 'Contact details'));
    panel.appendChild(head);
    panel.appendChild(el('p', 'admin-sub',
      'These appear in the footer, on the contact page and in the enquiry section of the home page. A change here reaches every page on its next load. No redeploy.'));

    if (!state.settingsEditable) {
      panel.appendChild(el('p', 'admin-empty',
        'This database has no site_settings table, so the details stay as the site was built with. Run supabase/migrations/0001_init.sql in the Supabase SQL Editor and reload this page to edit them here.'));
      return;
    }

    const form = el('form', 'admin-settings-form');
    const inputs = {};
    SETTINGS_FIELDS.forEach(([key, label, type]) => {
      const field = el('div', 'field');
      const id = `setting-${key}`;
      const lab = el('label', null, label);
      lab.htmlFor = id;
      const input = document.createElement('input');
      input.type = type;
      input.id = id;
      input.name = key;
      // Show what is live, whether it came from this table or the build.
      input.value = (state.settings && state.settings[key]) || (state.effective && state.effective[key]) || '';
      input.placeholder = 'Leave blank to use the value the site was built with';
      inputs[key] = input;
      field.appendChild(lab);
      field.appendChild(input);
      form.appendChild(field);
    });

    const status = el('div', 'form-status');
    const save = el('button', 'btn', 'Save changes');
    save.type = 'submit';
    form.appendChild(status);
    form.appendChild(save);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      status.className = 'form-status';
      status.textContent = '';
      const patch = { updated_at: new Date().toISOString() };
      SETTINGS_FIELDS.forEach(([key]) => {
        patch[key] = inputs[key].value.trim() || null;
      });
      try {
        await client.update('site_settings', 'id=eq.default', patch);
        state.settings = Object.assign({}, state.settings, patch);
        status.className = 'form-status ok';
        status.textContent = 'Saved. Every page picks these up on its next load.';
      } catch (err) {
        status.className = 'form-status bad';
        status.textContent = err.message;
      } finally {
        save.disabled = false;
      }
    });

    panel.appendChild(form);
  }

  function render() {
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-panel') !== state.tab;
    });
    document.querySelectorAll('.admin-tab').forEach((tab) => {
      const on = tab.getAttribute('data-tab') === state.tab;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    if (state.tab === 'enquiries') renderEnquiries();
    if (state.tab === 'applications') renderApplications();
    if (state.tab === 'chat') renderChat();
    if (state.tab === 'email') renderEmail();
    if (state.tab === 'settings') renderSettings();
    tallies();
  }

  /* ------------------------------------------------------------- fetch --- */

  async function refreshLists() {
    try {
      const [enquiries, sessions] = await Promise.all([loadEnquiries(), loadSessions()]);
      state.enquiries = (enquiries || []).filter(
        (row) => !String(row.service || '').startsWith(APPLICATION_MARKER)
      );
      state.sessions = sessions || [];
      try {
        state.applications = (await loadApplications()) || [];
      } catch (err) {
        // The table arrives with 0001_init.sql; a database built before it
        // simply has no applications rather than a broken dashboard.
        state.applications = [];
      }
      if (state.emailAvailable) {
        try {
          state.threads = (await loadThreads()) || [];
        } catch (err) {
          // 0002_email.sql is optional; a site not receiving mail has no tables.
          state.emailAvailable = false;
          state.threads = [];
        }
      }
      if (state.settings === null && state.settingsEditable) await loadSettings();
      alertBar('');
    } catch (err) {
      alertBar(err.message);
    }
    render();
  }

  async function refreshThread() {
    try {
      if (state.tab === 'chat' && state.active.chat) {
        state.messages = (await loadMessages(state.active.chat)) || [];
      } else if (state.tab === 'email' && state.active.email && state.emailAvailable) {
        state.mail = (await loadMail(state.active.email)) || [];
      } else {
        return;
      }
      render();
    } catch (err) {
      alertBar(err.message);
    }
  }

  /* -------------------------------------------------------------- boot --- */

  async function isAdmin(user) {
    if (!user || user.is_anonymous) return false;
    const rows = await client.select('admins', `select=user_id&user_id=eq.${user.id}&limit=1`);
    return rows.length > 0;
  }

  function wire() {
    document.querySelectorAll('.admin-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.tab = tab.getAttribute('data-tab');
        render();
        refreshThread();
      });
    });

    $('admin-signout').addEventListener('click', async () => {
      await client.auth.signOut();
      window.location.reload();
    });

    $('login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('login-btn');
      const error = $('login-error');
      error.textContent = '';
      button.disabled = true;
      try {
        await client.auth.signInWithPassword($('login-email').value.trim(), $('login-password').value);
        await enter();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });

    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (screens.shell.hidden) return;
      // Never rebuild the page under someone's cursor. Refreshing while a
      // field has focus replaces the element being typed into, which reads as
      // the text vanishing, or as a value you just deleted coming back.
      if (isTyping()) return;
      refreshLists();
      refreshThread();
    }, POLL_MS);
  }

  /** Decide which screen the current session earns. */
  async function enter() {
    const token = await client.auth.accessToken();
    const user = client.auth.user();
    if (!token || !user) return show('login');

    let admin = false;
    try {
      admin = await isAdmin(user);
    } catch (err) {
      $('login-note').textContent = err.message;
      return show('login');
    }

    if (!admin) {
      $('login-note').textContent =
        'That account is not on the admin list. Grant it by running supabase/grant-admin.sql with this address, or sign in with a different account.';
      await client.auth.signOut();
      return show('login');
    }

    $('admin-who').textContent = user.email || '';
    show('shell');
    await refreshLists();
    await refreshThread();
  }

  /** Say which value is missing and what the server would accept for it. */
  function explainUnconfigured(cfg, reason) {
    const target = $('admin-missing');
    if (!target) return show('unconfigured');
    target.textContent = '';

    if (reason) {
      target.appendChild(el('p', 'admin-note', reason));
      return show('unconfigured');
    }

    (cfg.missing || []).forEach((item) => {
      const p = el('p', 'admin-note');
      p.appendChild(document.createTextNode(
        item.value === 'supabaseUrl'
          ? 'The project URL is not set on this deployment. Accepted names: '
          : 'The browser key is not set on this deployment. Accepted names: '
      ));
      (item.accepts || []).forEach((name, i) => {
        if (i) p.appendChild(document.createTextNode(', '));
        p.appendChild(el('code', null, name));
      });
      p.appendChild(document.createTextNode('.'));
      target.appendChild(p);
    });

    if (!(cfg.missing || []).length) {
      target.appendChild(el('p', 'admin-note', 'The server did not return a Supabase URL or browser key.'));
    }
    return show('unconfigured');
  }

  async function boot() {
    let cfg = {};
    try {
      const res = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
      if (!res.ok) return explainUnconfigured(cfg, `The API answered ${res.status} for /api/public-config.`);
      cfg = await res.json();
    } catch (err) {
      return explainUnconfigured(cfg, 'The API could not be reached from this page.');
    }
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return explainUnconfigured(cfg);

    client = window.MerkelSupabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      // Its own key, so a member of staff signing in here does not displace
      // the anonymous session the chat widget uses on the public pages.
      storageKey: 'rockfield-desk-auth',
    });

    wire();
    await enter();
  }

  boot();
})();
