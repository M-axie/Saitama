/**
 * In-memory game session store, keyed by WhatsApp chat JID.
 * One active game per chat. Idle sessions auto-expire so a forgotten
 * game doesn't linger forever.
 */
const config = require('../config');

class SessionManager {
  constructor() {
    this.sessions = new Map(); // jid -> { game, lastActive }
  }

  start(jid, game) {
    this.sessions.set(jid, { game, lastActive: Date.now() });
    return game;
  }

  get(jid) {
    const session = this.sessions.get(jid);
    if (!session) return null;

    if (Date.now() - session.lastActive > config.sessionTimeoutMs) {
      this.sessions.delete(jid);
      return null;
    }

    session.lastActive = Date.now();
    return session.game;
  }

  // Internal clocks must not count as player activity. Message handlers use
  // get(), while background game timers use peek().
  peek(jid) {
    const session = this.sessions.get(jid);
    if (!session) return null;

    if (Date.now() - session.lastActive > config.sessionTimeoutMs) {
      this.sessions.delete(jid);
      return null;
    }

    return session.game;
  }

  end(jid) {
    this.sessions.delete(jid);
  }

  has(jid) {
    return !!this.get(jid);
  }
}

// singleton — one manager for the whole bot process
module.exports = new SessionManager();
