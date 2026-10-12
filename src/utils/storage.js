'use strict';

/**
 * Record persistence for the things visitors send us.
 *
 * Supabase in production; local JSON files when it is not configured, so
 * development works offline.
 */

const fs = require('fs/promises');
const path = require('path');
const { dataDir } = require('./paths');
const { getSupabase } = require('./supabase');

/**
 * One store per kind of record. Enquiries and job applications differ only in
 * their table, their file and the shape of a row, so the mechanics of falling
 * back to disk, serialising writes and mapping columns live here once.
 */
function createStore({ table, file, toRow, fromRow }) {
  const filePath = () => path.join(dataDir(), file);
  let writeChain = Promise.resolve();

  async function readFromFile() {
    try {
      const raw = await fs.readFile(filePath(), 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  return {
    async readAll() {
      const supabase = getSupabase();
      if (supabase) {
        const rows = await supabase.select(table, 'select=*&order=created_at.desc');
        return rows.map(fromRow);
      }
      return readFromFile();
    },

    async append(record) {
      const supabase = getSupabase();
      if (supabase) {
        await supabase.insert(table, toRow(record));
        return record;
      }

      const task = writeChain.then(async () => {
        await fs.mkdir(dataDir(), { recursive: true });
        const all = await readFromFile();
        all.push(record);
        await fs.writeFile(filePath(), JSON.stringify(all, null, 2), 'utf8');
        return record;
      });
      writeChain = task.catch(() => {});
      return task;
    },
  };
}

const enquiries = createStore({
  table: 'enquiries',
  file: 'submissions.json',
  toRow: (r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    company: r.company,
    service: r.service,
    message: r.message,
    ip: r.ip,
    created_at: r.receivedAt,
  }),
  fromRow: (row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    service: row.service,
    message: row.message,
    ip: row.ip,
    receivedAt: asIso(row.created_at),
  }),
});

const applications = createStore({
  table: 'applications',
  file: 'applications.json',
  toRow: (r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    role_id: r.roleId,
    role_title: r.roleTitle,
    portfolio: r.portfolio,
    experience: r.experience,
    message: r.message,
    ip: r.ip,
    created_at: r.receivedAt,
  }),
  fromRow: (row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    roleId: row.role_id,
    roleTitle: row.role_title,
    portfolio: row.portfolio,
    experience: row.experience,
    message: row.message,
    ip: row.ip,
    receivedAt: asIso(row.created_at),
  }),
});

module.exports = {
  createStore,
  applications,
  // The enquiry store is the original API of this module; callers predate the
  // factory and there is no reason to make them spell it out.
  readAll: enquiries.readAll,
  append: enquiries.append,
  enquiries,
};
