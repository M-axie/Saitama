try {
  require.resolve('@whiskeysockets/baileys');
} catch {
  console.error(
    '[Saitama V2] Missing dependencies. Run `npm install` in the bot folder, then start with `npm start`.'
  );
  process.exit(1);
}

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const readline = require('readline');

const config = require('./config');
const { handleToolCommand } = require('./handlers/commands/toolcommands');
const { handleHelpCommand } = require('./handlers/commands/helpcommands');
const { handleFeatureCommand } = require('./handlers/commands/featurecommands');
const { startDashboard } = require('./dashboard/server');
const { getFlag } = require('./lib/settingsStore');

const PAIRING_RETRY_LIMIT = 3;
const PAIRING_RETRY_DELAY_MS = 2500;
const PAIRING_FALLBACK_DELAY_MS = 8000;
const GLOBAL_KEY = 'global'; // pseudo-jid for bot-wide (non per-chat) flags
const LINK_PATTERN = /(https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/)\S+/i;
const RECENT_MESSAGE_LIMIT = 500;

let reconnectTimer = null;
let shuttingDown = false;
let alwaysOnlineTimer = null;
let restartNoticeSent = false; // only DM the owner once per process, not on every reconnect

// Small rolling cache of recent message text, keyed by message id, so
// !antidelete can show what a deleted message said. Capped and pruned by
// insertion order (a Map preserves it) to avoid unbounded memory growth.
const recentMessages = new Map();
function rememberMessage(m, text) {
  if (!text) return;
  recentMessages.set(m.key.id, { jid: m.key.remoteJid, sender: m.key.participant || m.key.remoteJid, text });
  if (recentMessages.size > RECENT_MESSAGE_LIMIT) {
    recentMessages.delete(recentMessages.keys().next().value);
  }
}

async function isSenderGroupAdmin(saitama, m) {
  try {
    const meta = await saitama.groupMetadata(m.key.remoteJid);
    const who = m.key.participant || m.key.remoteJid;
    return Boolean(meta?.participants?.some((p) => p.id === who && p.admin));
  } catch { return false; }
}

// Hide Bad MAC spam from console - it's just old status messages
const _origError = console.error;
console.error = (...args) => {
  const msg = String(args[0] || '');
  if (msg.includes('Bad MAC') || msg.includes('Session error')) return;
  _origError(...args);
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatPairingCode(code) {
  return String(code).match(/.{1,4}/g)?.join('-') || String(code);
}

function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return /^\d{8,15}$/.test(digits)? digits : '';
}

function normalizePairingCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length!== 8) {
    console.warn(
      `[${config.botName}] ignoring custom pairing code "${raw}": it is ${cleaned.length} ` +
      'characters after removing dashes/spaces, and WhatsApp requires exactly 8 (A-Z and 0-9).'
    );
    return '';
  }
  return cleaned;
}

function printPairingCode(code) {
  const line = '─'.repeat(48);
  console.log(`\n${line}`);
  console.log(` ${config.botName} pairing code: ${formatPairingCode(code)}`);
  console.log(' On the phone: WhatsApp > Settings > Linked Devices >');
  console.log(' Link a Device > "Link with phone number instead"');
  console.log(`${line}\n`);
}

function getStatusCode(lastDisconnect) {
  return lastDisconnect?.error?.output?.statusCode ||
    lastDisconnect?.error?.data?.statusCode ||
    lastDisconnect?.error?.statusCode;
}

function getMessageText(message) {
  let content = message?.message;
  for (let i = 0; i < 3; i++) {
    const wrapped = content?.ephemeralMessage?.message ||
      content?.viewOnceMessage?.message ||
      content?.viewOnceMessageV2?.message;
    if (!wrapped) break;
    content = wrapped;
  }
  return content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    '';
}

async function startSaitama() {
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const usingPairingCode = config.pairing.method === 'code' &&!state.creds.registered;
  let pairingRequested = false;
  let pairingTimer = null;
  let socketClosed = false;

  const saitama = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    shouldIgnoreJid: jid => jid === 'status@broadcast',
    browser: usingPairingCode
     ? Browsers.ubuntu('Chrome')
      : [config.botName, 'Chrome', '2.0.0']
  });

  saitama.ev.on('creds.update', saveCreds);

  async function requestPairingCode() {
    if (pairingRequested || socketClosed || state.creds.registered) return;
    pairingRequested = true;

    let phoneNumber = normalizePhoneNumber(config.pairing.phoneNumber || process.argv[2]);

    if (!phoneNumber) {
      if (!process.stdin.isTTY) {
        pairingRequested = false;
        console.error(
          `\n[${config.botName}] No WhatsApp number to pair with, and this console has no ` +
          'interactive input.\n' +
          ' Fix: set SAITAMA_PHONE_NUMBER=<country code + number, digits only>, ' +
          'or pass it as an argument: `node index.js 254799355427`.\n'
        );
        return;
      }
      const answer = await ask(
        `[${config.botName}] Enter the WhatsApp number to pair, with country code, digits only (e.g. 254799355427): `
      );
      phoneNumber = normalizePhoneNumber(answer);
      if (!phoneNumber) {
        pairingRequested = false;
        console.error(`[${config.botName}] Phone number must contain 8-15 digits including the country code.`);
        return;
      }
    }

    const customCode = normalizePairingCode(config.pairing.customCode);

    for (let attempt = 1; attempt <= PAIRING_RETRY_LIMIT; attempt++) {
      if (socketClosed || state.creds.registered) return;
      try {
        const code = customCode
         ? await saitama.requestPairingCode(phoneNumber, customCode)
          : await saitama.requestPairingCode(phoneNumber);
        printPairingCode(code);
        return;
      } catch (err) {
        console.error(
          `[${config.botName}] pairing code request failed (attempt ${attempt}/${PAIRING_RETRY_LIMIT}): ${err.message}`
        );
        if (attempt === PAIRING_RETRY_LIMIT) {
          pairingRequested = false;
          return;
        }
        await delay(PAIRING_RETRY_DELAY_MS);
      }
    }
  }

  saitama.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (usingPairingCode) {
        if (pairingTimer) {
          clearTimeout(pairingTimer);
          pairingTimer = null;
        }
        requestPairingCode().catch((err) => {
          console.error(`[${config.botName}] failed to request pairing code:`, err);
        });
      } else {
        console.log(`[${config.botName}] Scan this QR code to pair:`);
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'close') {
      socketClosed = true;
      if (pairingTimer) {
        clearTimeout(pairingTimer);
        pairingTimer = null;
      }
      if (alwaysOnlineTimer) {
        clearInterval(alwaysOnlineTimer);
        alwaysOnlineTimer = null;
      }
      const statusCode = getStatusCode(lastDisconnect);
      const shouldReconnect = statusCode!== DisconnectReason.loggedOut;
      console.log(`[${config.botName}] connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
      if (!shouldReconnect) {
        console.log(
          `[${config.botName}] logged out by WhatsApp. Delete the "${config.sessionDir}" folder and start again to re-pair.`
        );
      }
      if (shouldReconnect &&!shuttingDown &&!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          startSaitama().catch((err) => {
            console.error(`[${config.botName}] reconnect failed:`, err);
          });
        }, 1500);
      }
    } else if (connection === 'open') {
      if (pairingTimer) {
        clearTimeout(pairingTimer);
        pairingTimer = null;
      }
      console.log(`[${config.botName}] connected.`);
      if (!restartNoticeSent) {
        restartNoticeSent = true;
        saitama.sendMessage(config.ownerJid, {
          text: `✅ ${config.botName} restarted successfully.\n🕒 ${new Date().toISOString()}`
        }).catch((err) => {
          console.error(`[${config.botName}] restart notification failed:`, err.message);
        });
      }

      if (alwaysOnlineTimer) clearInterval(alwaysOnlineTimer);
      alwaysOnlineTimer = setInterval(() => {
        if (getFlag(GLOBAL_KEY, 'alwaysonline')) saitama.sendPresenceUpdate('available').catch(() => {});
      }, 25000);
      if (getFlag(GLOBAL_KEY, 'alwaysonline')) saitama.sendPresenceUpdate('available').catch(() => {});
    }
  });

  if (usingPairingCode) {
    pairingTimer = setTimeout(() => {
      pairingTimer = null;
      requestPairingCode().catch((err) => {
        console.error(`[${config.botName}] failed to request pairing code:`, err);
      });
    }, PAIRING_FALLBACK_DELAY_MS);
  }

  saitama.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type!== 'notify') return;

    for (const m of messages) {
      if (!m.message) continue;
      const jid = m.key.remoteJid;
      if (jid === 'status@broadcast') continue;
      const isGroupChat = jid.endsWith('@g.us');

      // A deletion arrives as a fromMe-or-not message carrying a protocolMessage
      // of type REVOKE (0), pointing back at the original message's key.
      const revoke = m.message.protocolMessage;
      if (revoke && revoke.type === 0 && revoke.key?.id) {
        if (getFlag(jid, 'antidelete')) {
          const original = recentMessages.get(revoke.key.id);
          if (original) {
            saitama.sendMessage(jid, {
              text: `🗑️ *Antidelete*\nMessage from @${String(original.sender).split('@')[0]} was deleted:\n\n${original.text}`,
              mentions: [original.sender]
            }).catch(() => {});
          }
        }
        continue;
      }

      if (m.key.fromMe) continue;

      const text = getMessageText(m);
      if (text) rememberMessage(m, text);

      try {
        // antilink: remove messages containing links/invite links from
        // non-admins in groups where it's enabled.
        if (isGroupChat && text && LINK_PATTERN.test(text) && getFlag(jid, 'antilink') && !(await isSenderGroupAdmin(saitama, m))) {
          await saitama.sendMessage(jid, { delete: m.key }).catch(() => {});
          await saitama.sendMessage(jid, { text: `🔗 Links aren't allowed here. Message removed.` }).catch(() => {});
          continue;
        }

        // antitagall: remove mass-mention messages from non-admins.
        const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (isGroupChat && mentioned.length >= 5 && getFlag(jid, 'antitagall') && !(await isSenderGroupAdmin(saitama, m))) {
          await saitama.sendMessage(jid, { delete: m.key }).catch(() => {});
          await saitama.sendMessage(jid, { text: `📛 Mass-tagging isn't allowed here. Message removed.` }).catch(() => {});
          continue;
        }

        if (config.messaging.autoView) await saitama.readMessages([m.key]).catch(() => {});
        if (getFlag(jid, 'autoreact')) await saitama.sendMessage(jid, { react: { text: '👍', key: m.key } }).catch(() => {});
        if (config.messaging.autoPresence) await saitama.sendPresenceUpdate('composing', jid).catch(() => {});
        let handled = await handleHelpCommand(saitama, m, text);
        if (!handled) handled = await handleToolCommand(saitama, m, text);
        if (!handled) await handleFeatureCommand(saitama, m, text);
        if (config.messaging.autoPresence) await saitama.sendPresenceUpdate('paused', jid).catch(() => {});
      } catch (err) {
        if (!String(err).includes('Bad MAC')) {
          console.error(`[${config.botName}] error handling message:`, err);
        }
      }
    }
  });

  saitama.ev.on('group-participants.update', async ({ id, participants, action }) => {
    try {
      const flagKey = action === 'add' ? 'welcome' : action === 'remove' ? 'bye' : null;
      if (!flagKey || !getFlag(id, flagKey)) return;
      const meta = await saitama.groupMetadata(id).catch(() => null);
      for (const p of participants) {
        const name = `@${String(p).split('@')[0]}`;
        const text = flagKey === 'welcome'
          ? `👋 Welcome ${name} to ${meta?.subject || 'the group'}!`
          : `👋 ${name} has left ${meta?.subject || 'the group'}.`;
        await saitama.sendMessage(id, { text, mentions: [p] }).catch(() => {});
      }
    } catch (err) {
      console.error(`[${config.botName}] welcome/bye handler failed:`, err.message);
    }
  });

  saitama.ev.on('call', async (calls) => {
    if (!getFlag(GLOBAL_KEY, 'anticall')) return;
    for (const call of calls) {
      if (call.status !== 'offer') continue;
      try {
        await saitama.rejectCall(call.id, call.from);
        await saitama.sendMessage(call.from, { text: '📵 Calls are not accepted by this bot.' }).catch(() => {});
      } catch (err) {
        console.error(`[${config.botName}] anticall reject failed:`, err.message);
      }
    }
  });

  return saitama;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

startSaitama().catch((err) => {
  console.error('Fatal error starting Saitama V2:', err);
  process.exit(1);
});

startDashboard().catch((err) => {
  console.error(`[${config.botName}] dashboard failed to start:`, err.message);
});
