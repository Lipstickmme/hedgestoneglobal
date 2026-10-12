'use strict';

/**
 * The notification centre and the secure message thread.
 *
 * Both exist because email is not a channel a bank can rely on: an alert that
 * bounced still has to be readable inside the account, and a customer sending
 * account details needs somewhere better than a reply-to.
 */

const { db } = require('../../bank/db');
const ids = require('../../bank/ids');
const audit = require('../../bank/audit');
const alertsLib = require('../../bank/alerts');
const { asyncHandler, fail, trimmed, page } = require('../../bank/http');

const nowIso = () => new Date().toISOString();

const publicAlert = (row) => ({
  id: row.id,
  type: row.type,
  subject: row.subject,
  preview: row.preview,
  body: row.body_text,
  severity: row.severity,
  status: row.status,
  channel: row.channel,
  createdAt: row.created_at,
  sentAt: row.sent_at,
  readAt: row.read_at,
});

const listAlerts = asyncHandler(async (req, res) => {
  const { limit, offset } = page(req.query);
  const rows = await db.alerts.find({ user_id: req.bankUser.id }, { order: 'created_at.desc' });
  res.json({
    alerts: rows.slice(offset, offset + limit).map(publicAlert),
    total: rows.length,
    unread: rows.filter((r) => !r.read_at).length,
  });
});

const readAlert = asyncHandler(async (req, res) => {
  const row = await db.alerts.findById(req.params.id);
  if (!row || row.user_id !== req.bankUser.id) throw fail(404, 'Notification not found.');
  if (!row.read_at) await db.alerts.update(row.id, { read_at: nowIso() });
  res.json({ alert: publicAlert({ ...row, read_at: row.read_at || nowIso() }) });
});

const readAllAlerts = asyncHandler(async (req, res) => {
  const rows = await db.alerts.find({ user_id: req.bankUser.id, read_at: null });
  for (const row of rows) await db.alerts.update(row.id, { read_at: nowIso() });
  res.json({ status: 'ok', marked: rows.length });
});

/* ------------------------------------------------------------- messages --- */

const publicMessage = (row) => ({
  id: row.id,
  threadId: row.thread_id,
  from: row.from_side,
  authorName: row.author_name,
  subject: row.subject,
  body: row.body,
  createdAt: row.created_at,
  readAt: row.read_at,
});

/** Messages grouped into threads, newest thread first. */
const listMessages = asyncHandler(async (req, res) => {
  const rows = await db.messages.find({ user_id: req.bankUser.id }, { order: 'created_at.asc' });
  const threads = new Map();
  rows.forEach((row) => {
    if (!threads.has(row.thread_id)) {
      threads.set(row.thread_id, { id: row.thread_id, subject: row.subject, messages: [], unread: 0, updatedAt: row.created_at });
    }
    const thread = threads.get(row.thread_id);
    thread.messages.push(publicMessage(row));
    thread.updatedAt = row.created_at;
    if (row.from_side === 'bank' && !row.read_at) thread.unread += 1;
  });
  res.json({
    threads: Array.from(threads.values()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
  });
});

const sendMessage = asyncHandler(async (req, res) => {
  const body = trimmed(req.body.body, 4000);
  if (!body) throw fail(400, 'Write a message first.');
  const threadId = req.body.threadId || ids.uuid();
  const subject = trimmed(req.body.subject, 140) || 'Secure message';

  const row = {
    id: ids.uuid(),
    created_at: nowIso(),
    thread_id: threadId,
    user_id: req.bankUser.id,
    from_side: 'customer',
    author_name: `${req.bankUser.first_name} ${req.bankUser.last_name}`.trim(),
    subject,
    body,
    read_at: nowIso(),
    attachments: null,
  };
  await db.messages.insert(row);
  await audit.log({
    action: 'message.sent', category: 'account', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Sent a secure message: ${subject}`,
  });
  res.status(201).json({ message: publicMessage(row), threadId });
});

const readThread = asyncHandler(async (req, res) => {
  const rows = await db.messages.find({ user_id: req.bankUser.id, thread_id: req.params.id });
  if (!rows.length) throw fail(404, 'Conversation not found.');
  // One write for the thread rather than one per unread message.
  const unread = rows.filter((row) => row.from_side === 'bank' && !row.read_at);
  if (unread.length) {
    await db.messages.updateWhere(
      { user_id: req.bankUser.id, thread_id: req.params.id, from_side: 'bank', read_at: null },
      { read_at: nowIso() }
    );
  }
  res.json({ status: 'ok', messages: rows.length });
});

module.exports = { listAlerts, readAlert, readAllAlerts, listMessages, sendMessage, readThread, publicAlert, publicMessage };
