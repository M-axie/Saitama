const config = require('../../config');
const { reply } = require('../../lib/reply');

const CATALOG = {
  AI: ['gpt', 'gptv', 'editimage', 'worm'],
  GENERAL: ['advice', 'forward', 'fwd2', 'getcmd', 'help', 'ping', 'profile', 'repo', 'uptime', 'settings', 'stats'],
  GROUP: ['addmode', 'approveall', 'close', 'delete', 'demote', 'disappear', 'gname', 'gpp', 'hidetag', 'joinmode', 'leave', 'link', 'open', 'pending', 'pin', 'promote', 'rejectall', 'remove', 'revoke', 'tagall', 'xkick'],
  MEDIA: ['vv', 'blur', 'compress', 'watermark', 'facebook', 'greyscale', 'instagram', 'play', 'take', 'rotate', 'sticker', 'tgsticker', 'tiktok', 'tiktokaudio', 'toimg', 'tomp3', 'upload', 'video', 'ytv', 'yta'],
  OWNER: ['block', 'blocklist', 'broadcast', 'exec', 'fullpp', 'gsettings', 'gsettings2', 'groupstatus', 'joingc', 'kill', 'kill2', 'eval', 'restart', 'setcmd', 'shutdown', 'token', 'privacy'],
  SETTINGS: ['alwaysonline', 'antibot', 'anticall', 'antidelete', 'antilink', 'antitagall', 'autoreact', 'autoview', 'bye', 'chatbot', 'presence', 'mode', 'prefix', 'welcome'],
  TOOLS: ['github', 'tts', 'removebg', 'bio', 'carbon', 'checkon', 'device', 'define', 'emojimix', 'fake', 'igstalk', 'ip', 'lyrics', 'movie', 'npm', 'ocr', 'pdf', 'qr', 'shazam', 'screenshot', 'shorturl', 'transcribe', 'translate'],
  WHATSAPP: ['pinchat', 'groupadd', 'lastseen', 'onlineprivacy', 'pp', 'statusprivacy']
};

const SAFE_DETAILS = {
  ai: `Ask the AI assistant: ${config.prefix}ai <message>. You can also use ${config.prefix}chat or ${config.prefix}gpt.`,
  chat: `Ask the AI assistant: ${config.prefix}chat <message>. Direct plain messages are answered automatically.`,
  gpt: `Ask the AI assistant: ${config.prefix}gpt <message>.`,
  help: 'Show this categorized command menu or details for one command.',
  ping: 'Check whether the bot is responding.', uptime: 'Show process uptime.', stats: 'Show bot and game statistics.',
  profile: 'Show the current chat profile summary.', settings: 'Show current bot and AI settings.',
  prefix: `Show the current command prefix (${config.prefix}).`, mode: 'Show whether auto AI replies (aimode) are on for this chat.',
  tiktok: 'Look up TikTok media through the configured media API.', video: 'Download or process video media through the configured media API.',
  ip: 'Look up an IP address through the configured utility API.',
  chatbot: `Turn auto AI replies on/off for this chat: ${config.prefix}chatbot on or ${config.prefix}chatbot off. With it off, ${config.prefix}ai <message> still works.`,
  advice: 'Ask the AI assistant for practical advice.',
  restart: 'Restart is cataloged and guarded; owner authorization is required before process control is enabled.'
};

const OWNER_ONLY = new Set(CATALOG.OWNER);
const allCommands = new Map(Object.entries(CATALOG).flatMap(([category, commands]) => commands.map((command) => [command, category])));

function catalogText(saitama, m) {
  const jid = m?.key?.remoteJid || '';
  const mode = jid.endsWith('@g.us') ? 'group' : 'private';
  const user = saitama?.user?.name || saitama?.user?.verifiedName || config.botName;
  const sections = Object.entries(CATALOG).map(([category, commands]) =>
    `\n*_${category}_*\n${commands.map((command) => ` • _${command}_`).join('\n')}`);
  return `*User:* ${user}\n*Prefix:* ${config.prefix}\n*Mode:* ${mode}\n` +
    sections.join('\n') +
    `\n\n> ${config.prefix}help <command> for details on any one command.`;
}

async function handleHelpCommand(saitama, m, text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith(config.prefix)) return false;
  const [command, arg] = raw.slice(config.prefix.length).trim().toLowerCase().split(/\s+/);
  if (command !== 'help') return false;
  if (!arg) { await reply(saitama, m, catalogText(saitama, m)); return true; }
  const category = CATALOG[arg.toUpperCase()];
  if (category) { await reply(saitama, m, `[ ${arg.toUpperCase()} ]\n${category.map((item) => `  ├─ ${config.prefix}${item}`).join('\n')}`); return true; }
  if (!allCommands.has(arg)) { await reply(saitama, m, `Unknown command: ${config.prefix}${arg}\nUse ${config.prefix}help to view the menu.`); return true; }
  const detail = SAFE_DETAILS[arg] || (OWNER_ONLY.has(arg)
    ? `Owner command in ${allCommands.get(arg)}. Enabled with a safety guard; explicit authorization is required for destructive actions.`
    : `Enabled under ${allCommands.get(arg)}. Use it directly or describe the task with ${config.prefix}chat.`);
  await reply(saitama, m, `[ ${config.prefix}${arg} ]\n> ${detail}`);
  return true;
}

module.exports = { handleHelpCommand, catalogText, CATALOG };
