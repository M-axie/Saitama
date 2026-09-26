/**
 * Persistent per-chat bot settings (chatbot/aimode, welcome, bye, antilink,
 * antitagall, antidelete, anticall, antibot, autoreact, autoview).
 * Backed by the same sqlite database as scoreStore, so it survives
 * restarts, reconnects, and process crashes — unlike the old in-memory
 * "settings" that reset on every restart.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const databasePath = path.resolve(config.databasePath);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_flags (
    jid TEXT NOT NULL,
    flag_key TEXT NOT NULL,
    value INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (jid, flag_key)
  );
`);

// One-time migration from the old single-purpose chat_settings table, if present.
try {
  const hasOldTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_settings'"
  ).get();
  if (hasOldTable) {
    const rows = db.prepare('SELECT jid, chatbot_enabled FROM chat_settings').all();
    const migrate = db.prepare(
      'INSERT OR IGNORE INTO chat_flags (jid, flag_key, value) VALUES (?, ?, ?)'
    );
    for (const row of rows) migrate.run(row.jid, 'chatbot', row.chatbot_enabled);
    db.exec('DROP TABLE chat_settings');
  }
} catch { /* best-effort migration only */ }

const getRow = db.prepare('SELECT value FROM chat_flags WHERE jid = ? AND flag_key = ?');
const upsertRow = db.prepare(`
  INSERT INTO chat_flags (jid, flag_key, value, updated_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(jid, flag_key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
`);
const listForJid = db.prepare('SELECT flag_key AS flagKey, value FROM chat_flags WHERE jid = ?');

// Flags default to this value when never explicitly set for a chat.
const DEFAULTS = {
  chatbot: true, autoview: true, autoreact: false, antilink: false,
  antitagall: false, antidelete: false, anticall: false, antibot: false,
  welcome: false, bye: false
};

function getFlag(jid, key) {
  const row = getRow.get(String(jid), key);
  if (!row) return Boolean(DEFAULTS[key]);
  return Boolean(row.value);
}

function setFlag(jid, key, value) {
  upsertRow.run(String(jid), key, value ? 1 : 0);
  return Boolean(value);
}

function getAllFlags(jid) {
  const rows = listForJid.all(String(jid));
  const out = { ...DEFAULTS };
  for (const row of rows) out[row.flagKey] = Boolean(row.value);
  return out;
}

// Back-compat helpers for the chatbot/aimode toggle specifically.
function isChatbotEnabled(jid) { return getFlag(jid, 'chatbot'); }
function setChatbotEnabled(jid, value) { return setFlag(jid, 'chatbot', value); }

module.exports = {
  databasePath, getFlag, setFlag, getAllFlags, isChatbotEnabled, setChatbotEnabled, DEFAULTS
};
