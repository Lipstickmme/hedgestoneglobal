'use strict';

/**
 * A deliberately strict stand-in for Supabase: PostgREST + GoTrue + the row
 * level security rules from supabase/migrations/0001_init.sql.
 *
 * Strict is the point. It rejects a column that is not in the table, exactly
 * as Postgres does, so code that writes `role`/`text` against a schema that
 * says `sender`/`body` fails here instead of in production.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ANON_KEY = 'anon-key';
const SERVICE_KEY = 'service-key';

const uuid = () => crypto.randomUUID();

/**
 * The bank's tables, read out of the migration that creates them.
 *
 * Parsed rather than copied, so the mock cannot drift from the real schema -
 * a hand-maintained list here would pass the probe test while the deployment
 * was missing a column, which is precisely the failure the probe exists to
 * catch.
 */
function bankTables() {
  // Every migration, in order, not just the one that creates the tables.
  // A later migration adds a column rather than recreating the table, and a
  // mock pinned to 0003 would pass a probe for a column the deployment does
  // not have - which is the failure this parsing exists to catch.
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  const sql = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');

  const tables = {};
  const created = /create table if not exists public\.(bank_\w+)\s*\(([\s\S]*?)\n\);/g;
  let match = created.exec(sql);
  while (match) {
    const [, table, body] = match;
    const columns = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('--') && !/^(constraint|primary key|unique|check|foreign key)\b/i.test(line))
      .map((line) => line.split(/\s+/)[0])
      .filter((name) => /^[a-z_][a-z0-9_]*$/.test(name));
    tables[table] = { columns, rows: [] };
    match = created.exec(sql);
  }

  const added = /alter table (?:if exists )?public\.(bank_\w+)\s+add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi;
  match = added.exec(sql);
  while (match) {
    const [, table, column] = match;
    if (tables[table] && !tables[table].columns.includes(column)) tables[table].columns.push(column);
    match = added.exec(sql);
  }

  return tables;
}

function schema() {
  return {
    ...bankTables(),
    admins: { columns: ['user_id', 'email', 'created_at'], rows: [] },
    enquiries: {
      columns: ['id', 'created_at', 'name', 'email', 'company', 'service', 'message', 'ip', 'status', 'notes'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString(), status: 'new' }),
      notNull: ['name', 'email', 'message'],
      rows: [],
    },
    site_settings: {
      columns: ['id', 'updated_at', 'address', 'email', 'phone', 'hours'],
      defaults: () => ({ id: 'default', updated_at: new Date().toISOString() }),
      rows: [{ id: 'default', updated_at: new Date().toISOString(), address: null, email: null, phone: null, hours: null }],
    },
    applications: {
      columns: ['id', 'created_at', 'name', 'email', 'phone', 'role_id', 'role_title', 'portfolio', 'experience', 'message', 'ip', 'status', 'notes'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString(), status: 'new' }),
      notNull: ['name', 'email', 'message'],
      rows: [],
    },
    chat_sessions: {
      columns: ['id', 'created_at', 'visitor_id', 'visitor_name', 'visitor_email', 'last_message_at', 'status', 'handled_by_agent'],
      defaults: () => ({
        id: uuid(),
        created_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        status: 'new',
        handled_by_agent: false,
      }),
      notNull: ['visitor_id'],
      rows: [],
    },
    chat_messages: {
      columns: ['id', 'created_at', 'session_id', 'sender', 'body'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString() }),
      notNull: ['session_id', 'sender', 'body'],
      check: (row) => {
        if (!['visitor', 'agent'].includes(row.sender)) {
          return 'new row for relation "chat_messages" violates check constraint "chat_messages_sender_check"';
        }
        if (!row.body || String(row.body).length > 4000) {
          return 'new row for relation "chat_messages" violates check constraint "chat_messages_body_check"';
        }
        return null;
      },
      rows: [],
    },
    email_threads: {
      columns: ['id', 'created_at', 'last_message_at', 'subject', 'participant_email', 'participant_name', 'status'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString(), last_message_at: new Date().toISOString(), status: 'new' }),
      notNull: ['participant_email'],
      rows: [],
    },
    email_messages: {
      columns: ['id', 'created_at', 'thread_id', 'direction', 'from_email', 'from_name', 'to_email', 'subject', 'body_text', 'body_html', 'message_id', 'in_reply_to', 'has_attachments'],
      defaults: () => ({ id: uuid(), created_at: new Date().toISOString(), has_attachments: false }),
      notNull: ['thread_id', 'direction', 'from_email', 'to_email'],
      rows: [],
    },
  };
}

function start({ tables, port = 0, drop = [] }) {
  const db = tables || schema();
  // `drop` simulates a database built from an older migration.
  drop.forEach((spec) => {
    const [table, column] = spec.split('.');
    if (db[table]) db[table].columns = db[table].columns.filter((c) => c !== column);
  });

  const sessions = new Map(); // access_token -> user
  const users = new Map(); // email -> { id, email, password }

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const fail = (res, status, code, message) => json(res, status, { code, message });

  function identify(req) {
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (auth === SERVICE_KEY) return { role: 'service_role' };
    if (sessions.has(auth)) return { role: 'authenticated', user: sessions.get(auth) };
    return { role: 'anon' };
  }

  const isAdmin = (who) =>
    Boolean(who.user && db.admins.rows.some((r) => r.user_id === who.user.id));

  /** The policies from 0001_init.sql, as predicates. */
  function canRead(table, row, who) {
    if (who.role === 'service_role') return true;
    if (who.role !== 'authenticated') return false;
    if (isAdmin(who)) return true;
    if (table === 'admins') return row.user_id === who.user.id;
    if (table === 'chat_sessions') return row.visitor_id === who.user.id;
    if (table === 'chat_messages') {
      const session = db.chat_sessions.rows.find((s) => s.id === row.session_id);
      return Boolean(session && session.visitor_id === who.user.id);
    }
    return false;
  }

  function canWrite(table, row, who) {
    if (who.role === 'service_role') return true;
    if (who.role !== 'authenticated') return false;
    if (table === 'chat_sessions') return row.visitor_id === who.user.id || isAdmin(who);
    if (table === 'chat_messages') {
      if (row.sender === 'agent') return isAdmin(who);
      const session = db.chat_sessions.rows.find((s) => s.id === row.session_id);
      return Boolean(session && session.visitor_id === who.user.id);
    }
    return isAdmin(who);
  }

  function matches(row, filters) {
    return filters.every(([column, op, value]) => {
      if (op !== 'eq') return true;
      return String(row[column]) === value;
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : {};

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      });
      return res.end();
    }

    /* ------------------------------------------------------------ GoTrue -- */

    if (url.pathname === '/auth/v1/signup') {
      if (!body.email) {
        if (!server.anonymousEnabled) {
          return fail(res, 422, 'anonymous_provider_disabled', 'Anonymous sign-ins are disabled');
        }
        const user = { id: uuid(), email: null, is_anonymous: true };
        const token = uuid();
        sessions.set(token, user);
        return json(res, 200, { access_token: token, refresh_token: uuid(), expires_in: 3600, user });
      }
      const user = { id: uuid(), email: body.email, is_anonymous: false };
      users.set(body.email, { ...user, password: body.password });
      return json(res, 200, { user });
    }

    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const found = users.get(body.email);
        if (!found || found.password !== body.password) {
          return fail(res, 400, 'invalid_credentials', 'Invalid login credentials');
        }
        const user = { id: found.id, email: found.email, is_anonymous: false };
        const token = uuid();
        sessions.set(token, user);
        return json(res, 200, { access_token: token, refresh_token: uuid(), expires_in: 3600, user });
      }
      return fail(res, 400, 'invalid_grant', 'Unsupported grant');
    }

    if (url.pathname === '/auth/v1/logout') {
      const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      sessions.delete(auth);
      return json(res, 204);
    }

    // Resolves a bearer token to its user. Server routes that cannot rely on
    // row level security check a caller's session here.
    if (url.pathname === '/auth/v1/user') {
      const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = sessions.get(auth);
      if (!user) return fail(res, 401, 'invalid_token', 'Invalid or expired token');
      return json(res, 200, user);
    }

    /* ---------------------------------------------------------- PostgREST -- */

    const restMatch = /^\/rest\/v1\/([A-Za-z0-9_]+)$/.exec(url.pathname);
    if (!restMatch) return fail(res, 404, 'PGRST404', `No route for ${url.pathname}`);

    const name = restMatch[1];
    const table = db[name];
    if (!table) {
      return fail(res, 404, 'PGRST205', `Could not find the table 'public.${name}' in the schema cache`);
    }

    const who = identify(req);
    const known = (column) => table.columns.includes(column);

    const filters = [];
    let select = null;
    let order = null;
    let limit = null;
    url.searchParams.forEach((value, key) => {
      if (key === 'select') select = value.split(',').map((s) => s.trim());
      else if (key === 'order') order = value;
      else if (key === 'limit') limit = Number(value);
      else if (key === 'on_conflict') void 0;
      else {
        const [op, ...rest] = value.split('.');
        filters.push([key, op, rest.join('.')]);
      }
    });

    const unknownSelect = (select || []).filter((c) => c !== '*' && !known(c));
    const unknownFilter = filters.map(([c]) => c).filter((c) => !known(c));
    const missing = unknownSelect.concat(unknownFilter)[0];
    if (missing) {
      return fail(res, 400, '42703', `column ${name}.${missing} does not exist`);
    }

    const project = (row) => {
      if (!select || select.includes('*')) return { ...row };
      const out = {};
      select.forEach((c) => {
        out[c] = row[c];
      });
      return out;
    };

    if (req.method === 'GET') {
      let rows = table.rows.filter((row) => matches(row, filters) && canRead(name, row, who));
      if (order) {
        const [column, direction] = order.split('.');
        rows = rows.slice().sort((a, b) => {
          const cmp = String(a[column]).localeCompare(String(b[column]));
          return direction === 'desc' ? -cmp : cmp;
        });
      }
      if (limit) rows = rows.slice(0, limit);
      return json(res, 200, rows.map(project));
    }

    const prefer = String(req.headers.prefer || '');

    if (req.method === 'POST') {
      const incoming = Array.isArray(body) ? body : [body];
      const created = [];
      for (const input of incoming) {
        const unknown = Object.keys(input).filter((c) => !known(c));
        if (unknown.length) {
          return fail(res, 400, 'PGRST204', `Could not find the '${unknown[0]}' column of '${name}' in the schema cache`);
        }

        const row = { ...(table.defaults ? table.defaults() : {}) };
        Object.entries(input).forEach(([k, v]) => {
          if (v !== undefined) row[k] = v;
        });

        const nullish = (table.notNull || []).find((c) => row[c] === undefined || row[c] === null);
        if (nullish) {
          return fail(res, 400, '23502', `null value in column "${nullish}" of relation "${name}" violates not-null constraint`);
        }

        const violated = table.check && table.check(row);
        if (violated) return fail(res, 400, '23514', violated);

        if (name === 'chat_messages' && !db.chat_sessions.rows.some((s) => s.id === row.session_id)) {
          return fail(res, 409, '23503', `insert or update on table "chat_messages" violates foreign key constraint "chat_messages_session_id_fkey"`);
        }

        if (!canWrite(name, row, who)) {
          return fail(res, 403, '42501', `new row violates row-level security policy for table "${name}"`);
        }

        const clash = table.rows.find((r) => r.id && row.id && r.id === row.id);
        if (clash) {
          if (/ignore-duplicates/.test(prefer)) continue;
          return fail(res, 409, '23505', `duplicate key value violates unique constraint "${name}_pkey"`);
        }

        table.rows.push(row);
        created.push(row);

        // The touch trigger from the migration.
        if (name === 'chat_messages') {
          const session = db.chat_sessions.rows.find((s) => s.id === row.session_id);
          if (session) {
            session.last_message_at = row.created_at;
            if (row.sender === 'visitor') session.status = 'new';
          }
        }
      }
      if (/return=representation/.test(prefer)) return json(res, 201, created.map(project));
      return json(res, 201);
    }

    if (req.method === 'PATCH') {
      const unknown = Object.keys(body).filter((c) => !known(c));
      if (unknown.length) {
        return fail(res, 400, 'PGRST204', `Could not find the '${unknown[0]}' column of '${name}' in the schema cache`);
      }
      const rows = table.rows.filter((row) => matches(row, filters) && canRead(name, row, who));
      for (const row of rows) {
        if (!canWrite(name, { ...row, ...body }, who)) {
          return fail(res, 403, '42501', `row violates row-level security policy for table "${name}"`);
        }
        Object.assign(row, body);
      }
      if (/return=representation/.test(prefer)) return json(res, 200, rows.map(project));
      return json(res, 204);
    }

    if (req.method === 'DELETE') {
      // PostgREST refuses an unfiltered delete, and so does this: a mistyped
      // filter that silently emptied a table would be a poor thing to learn
      // about from a test suite rather than from the mock.
      if (!filters.length) {
        return fail(res, 400, 'PGRST109', 'DELETE requires a filter');
      }
      const doomed = table.rows.filter((row) => matches(row, filters) && canRead(name, row, who));
      for (const row of doomed) {
        if (!canWrite(name, row, who)) {
          return fail(res, 403, '42501', `row violates row-level security policy for table "${name}"`);
        }
      }
      table.rows = table.rows.filter((row) => !doomed.includes(row));
      if (/return=representation/.test(prefer)) return json(res, 200, doomed.map(project));
      return json(res, 204);
    }

    return fail(res, 405, 'PGRST405', 'Method not allowed');
  });

  server.anonymousEnabled = true;
  server.db = db;
  server.users = users;
  server.createUser = (email, password, { admin } = {}) => {
    const user = { id: uuid(), email, is_anonymous: false };
    users.set(email, { ...user, password });
    if (admin) db.admins.rows.push({ user_id: user.id, email, created_at: new Date().toISOString() });
    return user;
  };

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { start, schema, ANON_KEY, SERVICE_KEY };
