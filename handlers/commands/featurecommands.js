const config = require('../../config');
const { reply } = require('../../lib/reply');
const { chat, clear, enabled } = require('../../lib/aiClient');
const { apiGetAny, apiPostAny } = require('../../lib/apiClient');
const { isChatbotEnabled, setChatbotEnabled, getFlag, setFlag } = require('../../lib/settingsStore');
const sessionManager = require('../../lib/sessionManager');
const { CATALOG } = require('./helpcommands');

const GLOBAL_KEY = 'global'; // pseudo-jid used for bot-wide (not per-chat) flags

const OWNER_ONLY = new Set(['block', 'blocklist', 'broadcast', 'exec', 'eval', 'fullpp', 'gsettings', 'gsettings2', 'groupstatus', 'joingc', 'kill', 'kill2', 'restart', 'setcmd', 'shutdown', 'token', 'privacy', 'lastseen', 'onlineprivacy', 'statusprivacy', 'pinchat']);
const ADMIN_ONLY = new Set(['addmode', 'approveall', 'close', 'delete', 'demote', 'gname', 'gpp', 'groupadd', 'hidetag', 'joinmode', 'leave', 'link', 'open', 'pending', 'pin', 'promote', 'rejectall', 'remove', 'revoke', 'tagall', 'xkick', 'disappear']);
const ALIASES = { ask: 'chat', assistant: 'chat', bot: 'chat', clearai: 'clearchat', tt: 'tiktok', kick: 'remove' };
const AI_COMMANDS = new Set(['ai', 'chat', 'gpt', 'gptv', 'advice']);
const AI_API_COMMANDS = new Set(['translate', 'summarize', 'code']);
const TOGGLE_FLAGS = new Set(['welcome', 'bye', 'antilink', 'antitagall', 'antidelete', 'anticall', 'antibot', 'autoreact', 'autoview']);

const API_TOOLS = {
  translate: { method: 'post', path: '/api/tools/ai/translate', body: (arg) => ({ text: arg }) },
  summarize: { method: 'post', path: '/api/tools/ai/summarize', body: (arg) => ({ text: arg }) },
  code: { method: 'post', path: '/api/tools/ai/code', body: (arg) => ({ code: arg, action: 'explain' }) },
  define: { method: 'get', path: '/api/tools/dictionary', params: (arg) => ({ word: arg }) },
  dictionary: { method: 'get', path: '/api/tools/dictionary', params: (arg) => ({ word: arg }) },
  weather: { method: 'get', path: '/api/tools/weather', params: (arg) => ({ location: arg }) },
  country: { method: 'get', path: '/api/tools/country', params: (arg) => ({ name: arg }) },
  currency: { method: 'get', path: '/api/tools/currency', params: (arg) => ({ query: arg }) },
  joke: { method: 'get', path: '/api/tools/joke', params: (arg) => ({ category: arg || 'Any' }) },
  quote: { method: 'get', path: '/api/tools/quote', params: (arg) => ({ tags: arg }) },
  fact: { method: 'get', path: '/api/tools/fact', params: () => ({}) },
  anime: { method: 'get', path: '/api/tools/anime', params: (arg) => ({ q: arg, limit: 5 }) },
  qr: { method: 'get', path: '/api/tools/qr', params: (arg) => ({ text: arg }) }
};

function usage(command, text) { return `Usage: ${config.prefix}${command}${text ? ` ${text}` : ''}`; }
function isGroup(jid) { return String(jid).endsWith('@g.us'); }
function isOwner(m) { return m.key.participant === config.ownerJid || m.key.remoteJid === config.ownerJid || m.sender === config.ownerJid; }
async function send(saitama, m, text) { await reply(saitama, m, text); return true; }
async function fail(saitama, m, label, err) { return send(saitama, m, `⚠️ ${label} failed: ${err.message}`); }
async function ask(saitama, m, jid, prompt) { if (!enabled()) return send(saitama, m, '🤖 AI replies are currently disabled.'); if (!prompt) return send(saitama, m, usage('chat', '<message>')); try { return send(saitama, m, `🤖 ${await chat(jid, prompt)}`); } catch (err) { return send(saitama, m, `⚠️ ${err.message}`); } }
async function groupMeta(saitama, jid) { return isGroup(jid) ? saitama.groupMetadata(jid) : null; }
async function isAdmin(saitama, m) { const meta = await groupMeta(saitama, m.key.remoteJid); const who = m.key.participant || m.participant; return Boolean(meta?.participants?.some((p) => p.id === who && p.admin)); }
async function guard(saitama, m, command, level) { if (level === 'owner' && !isOwner(m)) return send(saitama, m, `🛡️ ${config.prefix}${command} is owner-only.`); if (level === 'admin' && !isOwner(m) && !(await isAdmin(saitama, m))) return send(saitama, m, `🛡️ ${config.prefix}${command} requires group-admin permission.`); return false; }
function targetJid(arg) { const digits = String(arg || '').replace(/[^0-9]/g, ''); return digits ? `${digits}@s.whatsapp.net` : ''; }
function quotedInfo(m) { return m.message?.extendedTextMessage?.contextInfo || null; }

// Resolve a command's target: an explicit phone number/mention in the typed
// argument, falling back to whoever's message was replied to. Without the
// fallback, an admin replying to the person they want to remove and typing
// "!remove CONFIRM" (no number) would get a bare usage error.
function resolveTarget(m, cleanArg) {
  const explicit = targetJid(cleanArg);
  if (explicit) return explicit;
  const ctx = quotedInfo(m);
  if (ctx?.participant) return ctx.participant;
  if (ctx?.mentionedJid?.length) return ctx.mentionedJid[0];
  return '';
}

// Bare phone-number part of a JID, stripping both the "@server" suffix and
// any ":device" suffix (own JIDs from Baileys come back as "1234:5@s...").
function bareNumber(jid) { return String(jid || '').split('@')[0].split(':')[0]; }

// In groups, a plain (no-prefix) message only counts as "talking to the bot"
// when the bot is @mentioned or the message is a reply to one of the bot's
// own messages — otherwise every ordinary message between group members
// would trigger an AI reply.
function isBotAddressed(saitama, m) {
  const botNumber = bareNumber(saitama?.user?.id);
  if (!botNumber) return false;
  const ctx = quotedInfo(m);
  const mentioned = ctx?.mentionedJid || [];
  if (mentioned.some((j) => bareNumber(j) === botNumber)) return true;
  if (ctx?.participant && bareNumber(ctx.participant) === botNumber) return true;
  return false;
}

const plugins = [
  {
    name: 'ai', commands: AI_COMMANDS,
    handle: async ({ saitama, m, jid, command, arg }) => {
      if (command === 'advice') return ask(saitama, m, jid, arg || 'Give me practical advice.');
      return ask(saitama, m, jid, arg);
    }
  },
  {
    name: 'core', commands: new Set(['ping', 'uptime', 'prefix', 'mode', 'settings', 'profile', 'stats', 'clearchat', 'chatbot']),
    handle: async ({ saitama, m, jid, command, arg }) => {
      const chatbotOn = isChatbotEnabled(jid);
      const responses = {
        ping: '🏓 Pong! Saitama is online.', uptime: `⏱️ Uptime: ${Math.floor(process.uptime())} seconds`,
        prefix: `Current prefix: ${config.prefix}`,
        mode: `Mode: private/group compatible\nAuto AI replies (aimode) for this chat: ${chatbotOn ? 'ON' : 'OFF'}\nIn groups, plain messages only reach the AI when the bot is @mentioned or replied to; DMs always reach it.\nToggle: ${config.prefix}chatbot on / ${config.prefix}chatbot off`,
        settings: `⚙️ Prefix: ${config.prefix}\nAuto AI replies (aimode): ${chatbotOn ? 'ON' : 'OFF'}\n${config.prefix}ai command: always available`,
        profile: `👤 Chat: ${jid}\nBot: ${config.botName}`,
        stats: `📊 Uptime: ${Math.floor(process.uptime())}s\nCommands: ${Object.values(CATALOG).flat().length}\nAuto AI replies: ${chatbotOn ? 'ON' : 'OFF'}`
      };
      if (command === 'clearchat') { clear(jid); return send(saitama, m, '🧹 AI memory cleared.'); }
      if (command === 'chatbot') {
        const value = arg.toLowerCase();
        if (value === 'on' || value === 'off') {
          setChatbotEnabled(jid, value === 'on');
          return send(saitama, m, `🤖 Auto AI replies (aimode) are now *${value.toUpperCase()}* for this chat.\nThis is saved and will stay ${value.toUpperCase()} after restarts.\n${config.prefix}ai <message> still works either way.`);
        }
        return send(saitama, m, `🤖 Auto AI replies (aimode) are currently *${chatbotOn ? 'ON' : 'OFF'}* for this chat.\nUse ${config.prefix}chatbot on or ${config.prefix}chatbot off to change it.\n${config.prefix}ai <message> still works either way.`);
      }
      return send(saitama, m, responses[command]);
    }
  },
  {
    // Simple per-chat on/off flags, persisted and actually enforced in index.js
    // (welcome/bye/antilink/antitagall/antidelete/autoreact) or globally
    // (anticall). Group toggles require group-admin; DMs are unrestricted.
    name: 'toggles', commands: TOGGLE_FLAGS,
    handle: async ({ saitama, m, jid, command, arg }) => {
      if (isGroup(jid) && !isOwner(m) && !(await isAdmin(saitama, m))) {
        return send(saitama, m, `🛡️ ${config.prefix}${command} requires group-admin permission.`);
      }
      const value = String(arg || '').trim().toLowerCase();
      if (value === 'on' || value === 'off') {
        setFlag(jid, command, value === 'on');
        return send(saitama, m, `✅ *${command}* is now *${value.toUpperCase()}* for this chat.`);
      }
      return send(saitama, m, `*${command}* is currently *${getFlag(jid, command) ? 'ON' : 'OFF'}* for this chat.\nUse ${config.prefix}${command} on / ${config.prefix}${command} off to change it.`);
    }
  },
  {
    // Bot-wide (not per-chat) presence behavior. Owner-controlled.
    name: 'presence', commands: new Set(['alwaysonline', 'presence']),
    handle: async ({ saitama, m, jid, command, arg }) => {
      if (!isOwner(m)) return send(saitama, m, `🛡️ ${config.prefix}${command} is owner-only.`);
      if (command === 'presence') {
        return send(saitama, m, `🟢 Always-online: ${getFlag(GLOBAL_KEY, 'alwaysonline') ? 'ON' : 'OFF'}\n⌨️ Typing indicator: ${config.messaging.autoPresence ? 'ON' : 'OFF'}`);
      }
      const value = String(arg || '').trim().toLowerCase();
      if (value !== 'on' && value !== 'off') return send(saitama, m, usage(command, 'on | off'));
      setFlag(GLOBAL_KEY, 'alwaysonline', value === 'on');
      if (value === 'on') { try { await saitama.sendPresenceUpdate('available'); } catch { /* best-effort */ } }
      return send(saitama, m, `✅ Always-online is now *${value.toUpperCase()}*.`);
    }
  },
  {
    name: 'api', commands: new Set(Object.keys(API_TOOLS)),
    handle: async ({ saitama, m, command, arg }) => {
      const spec = API_TOOLS[command];
      if (AI_API_COMMANDS.has(command) && !enabled()) return send(saitama, m, '🤖 AI features are currently disabled.');
      if (!arg && !['fact', 'joke', 'quote'].includes(command)) return send(saitama, m, usage(command, '<value>'));
      try {
        const data = spec.method === 'post' ? await apiPostAny([spec.path], spec.body(arg)) : await apiGetAny([spec.path], spec.params(arg));
        const payload = data?.reply || data?.result || data?.data || data;
        return send(saitama, m, `✅ *${command}*\n\n${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}`);
      } catch (err) { return send(saitama, m, `⚠️ ${command} failed: ${err.message}`); }
    }
  },
  {
    // Read-only lookups against the bot's own WhatsApp session — no
    // group-admin/owner gate needed since nothing here is destructive.
    name: 'lookup', commands: new Set(['checkon', 'bio', 'pp', 'device', 'vv', 'forward', 'fwd2', 'getcmd', 'repo']),
    handle: async ({ saitama, m, jid, command, arg }) => {
      if (command === 'repo') return send(saitama, m, `🔗 ${config.botName} source: ask the owner (${config.ownerJid.split('@')[0]}) for the repo link.`);
      if (command === 'getcmd') return send(saitama, m, Object.values(CATALOG).flat().map((c) => `${config.prefix}${c}`).join(', '));
      if (command === 'device') return send(saitama, m, 'ℹ️ Device type (Android/iOS/Web) is not reliably exposed by WhatsApp\'s protocol, so this isn\'t implemented — let me know if you have a specific use case and I can look at options.');
      if (command === 'checkon') {
        const target = targetJid(arg); if (!target) return send(saitama, m, usage(command, '<phone>'));
        try { const [result] = await saitama.onWhatsApp(target); return send(saitama, m, result?.exists ? `✅ ${arg} is on WhatsApp.` : `❌ ${arg} is not on WhatsApp.`); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'bio') {
        const target = arg ? targetJid(arg) : (m.key.participant || m.key.remoteJid);
        try { const status = await saitama.fetchStatus(target || jid); return send(saitama, m, status?.status ? `📝 ${status.status}` : 'No bio set, or it is not visible to this account.'); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'pp') {
        const target = arg ? targetJid(arg) : (isGroup(jid) ? jid : jid);
        try { const url = await saitama.profilePictureUrl(target, 'image'); return send(saitama, m, `🖼️ ${url}`); }
        catch { return send(saitama, m, 'No profile picture found, or it is private.'); }
      }
      if (command === 'vv') {
        const ctx = quotedInfo(m);
        const quotedMsg = ctx?.quotedMessage;
        const viewOnce = quotedMsg?.viewOnceMessage?.message || quotedMsg?.viewOnceMessageV2?.message || quotedMsg?.viewOnceMessageV2Extension?.message;
        if (!viewOnce) return send(saitama, m, `Reply to a view-once photo/video with ${config.prefix}vv to reveal it.`);
        try { await saitama.sendMessage(jid, viewOnce, { quoted: m }); return true; }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'forward' || command === 'fwd2') {
        const ctx = quotedInfo(m);
        if (!ctx?.quotedMessage) return send(saitama, m, `Reply to a message with ${config.prefix}${command} to forward it.\nFor ${config.prefix}fwd2, also give a phone number: ${config.prefix}fwd2 <phone>`);
        const target = command === 'fwd2' ? targetJid(arg) : jid;
        if (command === 'fwd2' && !target) return send(saitama, m, usage(command, '<phone>'));
        try { await saitama.sendMessage(target, { forward: { key: { remoteJid: jid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant }, message: ctx.quotedMessage } }); return send(saitama, m, '✅ Forwarded.'); }
        catch (err) { return fail(saitama, m, command, err); }
      }
    }
  },
  {
    name: 'whatsapp', commands: new Set([...OWNER_ONLY, ...ADMIN_ONLY]),
    handle: async ({ saitama, m, jid, command, arg }) => {
      if (command === 'exec' || command === 'eval') return send(saitama, m, `🛡️ ${config.prefix}${command} is disabled by default.`);
      const level = OWNER_ONLY.has(command) ? 'owner' : 'admin';
      if (await guard(saitama, m, command, level)) return true;
      const CONFIRM_REQUIRED = new Set(['shutdown', 'restart', 'broadcast', 'block', 'delete', 'remove', 'promote', 'demote', 'groupadd', 'xkick', 'close', 'open']);
      // Trailing "CONFIRM" token, e.g. "27821234567 CONFIRM" or just "CONFIRM"
      // on its own. The old exact-match check (`arg !== 'CONFIRM'`) rejected
      // any command that also carried a target/value, making remove, promote,
      // demote, block, and broadcast impossible to actually run.
      const hasConfirm = /(?:^|\s)CONFIRM$/i.test(arg.trim());
      if (CONFIRM_REQUIRED.has(command) && !hasConfirm) {
        return send(saitama, m, `⚠️ Add CONFIRM at the end to authorize this: ${config.prefix}${command}${arg ? ` ${arg}` : ''} CONFIRM`);
      }
      const cleanArg = arg.replace(/\s*CONFIRM\s*$/i, '').trim();

      if (command === 'shutdown') { await send(saitama, m, '🛑 Shutting down.'); setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100); return true; }
      if (command === 'restart') { await send(saitama, m, '🔄 Restart requested.'); process.kill(process.pid, 'SIGTERM'); return true; }
      if (command === 'delete') {
        const ctx = quotedInfo(m);
        const target = ctx?.quotedMessage
          ? { remoteJid: jid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant }
          : m.key; // no reply given — fall back to deleting the command itself
        try { await saitama.sendMessage(jid, { delete: target }); return true; }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'gname') {
        if (!arg) return send(saitama, m, usage(command, '<name>'));
        try { await saitama.groupUpdateSubject(jid, arg); return send(saitama, m, '✅ Group name updated.'); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'link') {
        try { return send(saitama, m, `🔗 https://chat.whatsapp.com/${await saitama.groupInviteCode(jid)}`); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'revoke') {
        try { await saitama.groupRevokeInvite(jid); return send(saitama, m, '✅ Group invite link revoked.'); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'open' || command === 'close') {
        try {
          await saitama.groupSettingUpdate(jid, command === 'close' ? 'announcement' : 'not_announcement');
          return send(saitama, m, `✅ Group is now ${command === 'close' ? 'admins-only' : 'open'}.`);
        } catch (err) { return fail(saitama, m, command, err); }
      }
      if (['promote', 'demote', 'remove', 'groupadd', 'xkick'].includes(command)) {
        const target = resolveTarget(m, cleanArg);
        if (!target) return send(saitama, m, `${usage(command, '<phone> CONFIRM')}\n(or reply to the member's message with ${config.prefix}${command} CONFIRM)`);
        const action = command === 'groupadd' ? 'add' : command === 'xkick' ? 'remove' : command;
        try { await saitama.groupParticipantsUpdate(jid, [target], action); return send(saitama, m, `✅ ${command} completed.`); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'tagall' || command === 'hidetag') {
        const meta = await groupMeta(saitama, jid);
        if (!meta) return send(saitama, m, 'This command only works in groups.');
        try { await saitama.sendMessage(jid, { text: arg || 'Attention everyone', mentions: meta.participants.map((p) => p.id) }); return true; }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'leave') { try { await saitama.groupLeave(jid); return true; } catch (err) { return fail(saitama, m, command, err); } }
      if (command === 'pin') { try { await saitama.chatModify({ pin: true }, jid); return send(saitama, m, '📌 Chat pinned.'); } catch (err) { return fail(saitama, m, command, err); } }

      if (command === 'disappear') {
        const presets = { off: 0, '24h': 86400, '7d': 604800, '90d': 7776000 };
        const seconds = Object.prototype.hasOwnProperty.call(presets, arg.toLowerCase()) ? presets[arg.toLowerCase()] : Number(arg);
        if (!Number.isFinite(seconds)) return send(saitama, m, usage(command, 'off | 24h | 7d | 90d'));
        try { await saitama.groupToggleEphemeral(jid, seconds); return send(saitama, m, `✅ Disappearing messages set to ${arg || 'off'}.`); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'joinmode') {
        const value = arg.toLowerCase(); if (!['on', 'off'].includes(value)) return send(saitama, m, usage(command, 'on | off'));
        try { await saitama.groupJoinApprovalMode(jid, value); return send(saitama, m, `✅ Admin approval for new joins is now ${value.toUpperCase()}.`); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'addmode') {
        const map = { all: 'all_member_add', admin: 'admin_add' }; const value = map[arg.toLowerCase()];
        if (!value) return send(saitama, m, usage(command, 'all | admin'));
        try { await saitama.groupMemberAddMode(jid, value); return send(saitama, m, `✅ ${arg.toLowerCase() === 'all' ? 'Any member' : 'Only admins'} can add participants now.`); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'pending') {
        try { const list = await saitama.groupRequestParticipantsList(jid); return send(saitama, m, list.length ? `📋 Pending join requests:\n${list.map((p) => `• ${p.jid}`).join('\n')}` : '📭 No pending join requests.'); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'approveall' || command === 'rejectall') {
        const action = command === 'approveall' ? 'approve' : 'reject';
        try {
          const list = await saitama.groupRequestParticipantsList(jid);
          if (!list.length) return send(saitama, m, '📭 No pending join requests.');
          await saitama.groupRequestParticipantsUpdate(jid, list.map((p) => p.jid), action);
          return send(saitama, m, `✅ ${action}d ${list.length} join request(s).`);
        } catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'lastseen' || command === 'onlineprivacy' || command === 'statusprivacy') {
        const fnName = { lastseen: 'updateLastSeenPrivacy', onlineprivacy: 'updateOnlinePrivacy', statusprivacy: 'updateStatusPrivacy' }[command];
        const allowed = { lastseen: ['all', 'contacts', 'contact_blacklist', 'none'], onlineprivacy: ['all', 'match_last_seen'], statusprivacy: ['all', 'contacts', 'contact_blacklist', 'none'] }[command];
        const value = arg.toLowerCase();
        if (!allowed.includes(value)) return send(saitama, m, usage(command, allowed.join(' | ')));
        try { await saitama[fnName](value); return send(saitama, m, `✅ ${command} set to ${value}.`); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'pinchat') {
        const value = arg.toLowerCase() !== 'off';
        try { await saitama.chatModify({ pin: value }, jid); return send(saitama, m, `📌 Chat ${value ? 'pinned' : 'unpinned'}.`); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'privacy') {
        try {
          await saitama.updateLastSeenPrivacy('contacts');
          await saitama.updateOnlinePrivacy('match_last_seen');
          await saitama.updateStatusPrivacy('contacts');
          return send(saitama, m, '🔒 Privacy set to contacts-only for last seen, online, and status.');
        } catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'groupstatus') {
        const meta = await groupMeta(saitama, jid); if (!meta) return send(saitama, m, 'This command only works in groups.');
        return send(saitama, m, `📋 *${meta.subject}*\n👥 ${meta.participants.length} members\n📝 ${meta.desc || 'No description'}`);
      }
      if (command === 'joingc') {
        if (!cleanArg) return send(saitama, m, usage(command, '<invite link or code>'));
        const code = cleanArg.split('/').pop();
        try { await saitama.groupAcceptInvite(code); return send(saitama, m, '✅ Joined the group.'); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'block' || command === 'blocklist') {
        if (command === 'blocklist') {
          try { const list = await saitama.fetchBlocklist(); return send(saitama, m, list.length ? `🚫 Blocked:\n${list.join('\n')}` : 'No blocked contacts.'); }
          catch (err) { return fail(saitama, m, command, err); }
        }
        const target = resolveTarget(m, cleanArg); if (!target) return send(saitama, m, usage(command, '<phone> CONFIRM'));
        try { await saitama.updateBlockStatus(target, 'block'); return send(saitama, m, `🚫 Blocked ${cleanArg || target.split('@')[0]}.`); }
        catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'broadcast') {
        if (!cleanArg) return send(saitama, m, usage(command, '<message> CONFIRM'));
        try {
          const groups = await saitama.groupFetchAllParticipating();
          const ids = Object.keys(groups);
          for (const gid of ids) await saitama.sendMessage(gid, { text: `📢 *Broadcast*\n\n${cleanArg}` }).catch(() => {});
          return send(saitama, m, `📢 Broadcast sent to ${ids.length} group(s) the bot is in.`);
        } catch (err) { return fail(saitama, m, command, err); }
      }
      if (command === 'kill' || command === 'kill2') {
        const hadSession = sessionManager.has(jid); sessionManager.end(jid);
        return send(saitama, m, hadSession ? '🛑 Active game session ended.' : 'No active session to end here.');
      }

      return send(saitama, m, `✅ ${config.prefix}${command} is registered but not yet wired up — tell me exactly what you want it to do and I'll add it.`);
    }
  }
];

async function handleFeatureCommand(saitama, m, text) {
  const raw = String(text || '').trim(); const jid = m.key.remoteJid;
  if (!raw.startsWith(config.prefix)) {
    if (!enabled() || raw.length < 2) return false;
    if (!isChatbotEnabled(jid)) return false;
    // DMs: any plain message reaches the AI. Groups: only when the bot is
    // @mentioned or the message replies to one of the bot's own messages.
    if (isGroup(jid) && !isBotAddressed(saitama, m)) return false;
    return ask(saitama, m, jid, raw);
  }
  const [first, ...rest] = raw.slice(config.prefix.length).trim().split(/\s+/); const command = ALIASES[first.toLowerCase()] || first.toLowerCase(); const arg = rest.join(' ').trim();
  if (command === 'help') return false;
  const plugin = plugins.find((item) => item.commands.has(command));
  if (plugin) return plugin.handle({ saitama, m, jid, command, arg });
  if (Object.values(CATALOG).flat().includes(command)) return send(saitama, m, `✅ ${config.prefix}${command} is registered. Use ${config.prefix}help ${command} for its usage.`);
  return false;
}

module.exports = { handleFeatureCommand, helpText: () => 'AI replies are disabled. Use !help for the command menu.', plugins };
