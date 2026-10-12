'use strict';

/**
 * Chat persistence, shared by both halves of the live chat.
 *
 *   1. The visitor's browser writes its own rows straight to Supabase, signed
 *      in anonymously, so row level security can say "your own session". That
 *      path addresses conversations by their real uuid: `loadById`,
 *      `appendById`.
 *   2. When Supabase is not reachable from the browser the widget falls back
 *      to POST /api/chat/message, which lands here with an opaque localStorage
 *      token instead. `sessionUuid` derives a stable uuid from that token
 *      (RFC 4122 version 5), so a returning visitor lands back on the same
 *      conversation without a lookup table, and the admin dashboard sees one
 *      kind of row either way.
 *
 * With neither, conversations are JSON files under DATA_DIR, so development
 * works offline.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('./paths');
const { getSupabase } = require('./supabase');

const MESSAGES = 'chat_messages';
const SESSIONS = 'chat_sessions';
const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_DIR = () => path.join(dataDir(), 'chat');

// Fixed namespaces. Changing either orphans every existing conversation.
const NS_SESSION = 'b3f1c8de-5a47-4f0e-9d21-6c8a3e7b4f10';
const NS_VISITOR = 'e07a92c4-1d63-4b58-8f39-2a5d0c7e6b81';

let chain = Promise.resolve();

const asIso = (v) => (v instanceof Date ? v.toISOString() : v);

const isValidId = (id) => typeof id === 'string' && TOKEN.test(id);
const isUuid = (id) => typeof id === 'string' && UUID.test(id);

/** RFC 4122 version 5 uuid: sha1 over a namespace plus the name. */
function uuidV5(namespace, name) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const digest = crypto.createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  const b = Buffer.from(digest.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The database id for a widget token. Stable for that token's life. */
const sessionUuid = (token) => uuidV5(NS_SESSION, token);

/**
 * `chat_sessions.visitor_id` defaults to auth.uid(), which is null under the
 * service role, so the fallback path supplies its own. Derived rather than
 * random, so re-running never duplicates a session row.
 */
const visitorUuid = (token) => uuidV5(NS_VISITOR, token);

/* Roles: the app speaks user/agent, the schema speaks visitor/agent. */
const toSender = (role) => (role === 'agent' ? 'agent' : 'visitor');
const toRole = (sender) => (sender === 'agent' ? 'agent' : 'user');

/* ---------------------------------------------------------------- files --- */

async function loadFromFile(token) {
  try {
    const raw = await fs.readFile(path.join(CHAT_DIR(), `${token}.json`), 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.messages)) data.messages = [];
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return { sessionId: token, createdAt: new Date().toISOString(), messages: [] };
    throw err;
  }
}

async function appendToFile(token, messages) {
  const task = chain.then(async () => {
    await fs.mkdir(CHAT_DIR(), { recursive: true });
    const convo = await loadFromFile(token);
    convo.messages.push(...messages);
    if (messages.some((m) => m.role === 'agent' && m.byHuman)) convo.handedOver = true;
    convo.updatedAt = new Date().toISOString();
    await fs.writeFile(path.join(CHAT_DIR(), `${token}.json`), JSON.stringify(convo, null, 2), 'utf8');
    return convo;
  });
  chain = task.catch(() => {});
  return task;
}

/* ------------------------------------------------------------- by uuid --- */

/** Create the parent row if this is the first message of the conversation. */
async function ensureSession(supabase, id, visitorId) {
  await supabase.upsert(SESSIONS, { id, visitor_id: visitorId || id });
}

async function loadById(id) {
  const supabase = getSupabase();
  if (!supabase) return { sessionId: id, messages: [] };
  const rows = await supabase.select(
    MESSAGES,
    `select=sender,body,created_at&session_id=eq.${id}&order=created_at.asc&limit=200`
  );
  return {
    sessionId: id,
    messages: rows.map((r) => ({ role: toRole(r.sender), text: r.body, at: asIso(r.created_at) })),
  };
}

async function appendById(id, messages, opts = {}) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('chat: Supabase is not configured');
  if (opts.ensure) await ensureSession(supabase, id, opts.visitorId);
  await supabase.insert(
    MESSAGES,
    messages
      .map((m) => ({
        session_id: id,
        sender: toSender(m.role),
        body: String(m.text == null ? '' : m.text).slice(0, 4000),
        created_at: m.at,
      }))
      .filter((row) => row.body.length > 0)
  );
  return { sessionId: id, messages };
}

/**
 * True once a representative has answered, so the canned responder can
 * step aside rather than talking over them. It is its own column because a
 * trigger returns `status` to 'new' every time the visitor speaks.
 */
async function isHandedOverById(id) {
  const supabase = getSupabase();
  if (!supabase) return false;
  const rows = await supabase.select(SESSIONS, `select=handled_by_agent&id=eq.${id}&limit=1`);
  return Boolean(rows[0] && rows[0].handled_by_agent);
}

/* ------------------------------------------------------------ by token --- */

async function load(token) {
  const supabase = getSupabase();
  if (!supabase) return loadFromFile(token);
  const convo = await loadById(sessionUuid(token));
  return { sessionId: token, messages: convo.messages };
}

async function append(token, messages) {
  const supabase = getSupabase();
  if (!supabase) return appendToFile(token, messages);
  await appendById(sessionUuid(token), messages, { ensure: true, visitorId: visitorUuid(token) });
  return { sessionId: token, messages };
}

async function isHandedOver(token) {
  const supabase = getSupabase();
  if (!supabase) return Boolean((await loadFromFile(token)).handedOver);
  return isHandedOverById(sessionUuid(token));
}

module.exports = {
  load,
  append,
  isHandedOver,
  loadById,
  appendById,
  isHandedOverById,
  isValidId,
  isUuid,
  sessionUuid,
  visitorUuid,
};
