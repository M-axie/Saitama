/**
 * Routes utility commands (!ip, !info, !audio, !video, !tiktok, !yt)
 * to the Saitama API.
 */
const config = require('../../config');
const { reply, replyImage, replyVideo, replyAudio, doReact } = require('../../lib/reply');
const { apiGetAny, apiGetMediaAny, fetchBuffer } = require('../../lib/apiClient');

function unwrap(json) {
  let value = json;
  // Older deployments used different response wrapper names. Unwrap them
  // repeatedly, but stop when the payload is an array or primitive.
  for (let i = 0; i < 4; i++) {
    if (!value || Array.isArray(value) || typeof value !== 'object') break;
    const next = value.result ?? value.data ?? value.response ?? value.payload;
    if (next === undefined || next === value) break;
    value = next;
  }
  return value;
}

function findFirstValue(value, keys, depth = 0) {
  if (depth > 5 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstValue(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;

  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findFirstValue(child, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractMediaUrl(json) {
  return findFirstValue(json, [
    'url', 'download', 'download_url', 'downloadUrl', 'media_url',
    'mediaUrl', 'audio', 'audio_url', 'audioUrl', 'video', 'video_url',
    'videoUrl', 'noWatermark', 'nowm', 'link'
  ]);
}

function extractTitle(json) {
  return findFirstValue(json, ['title', 'name', 'filename', 'fileName']);
}

function safeFileName(name, extension) {
  const cleaned = String(name || 'saitama')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'saitama';
  return `${cleaned}.${extension}`;
}

async function withErrorReply(saitama, m, label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[toolcommands] ${label} failed:`, err);
    const detail = err.status ? ` (HTTP ${err.status})` : '';
    const reason = err.code === 'API_HTML_RESPONSE'
      ? 'The API deployment returned a web login page; republish it without deployment protection or set SAITAMA_API_URL to the active API URL.'
      : err.code === 'EMPTY_MEDIA_RESPONSE'
        ? 'The API endpoint responded successfully but returned no media bytes; the source may be unsupported or the API worker may be failing.'
      : 'Try again in a bit, or the link/query might not be supported.';
    await reply(saitama, m, `⚠️ ${label} failed${detail}. ${reason}`);
  }
}

async function handleIp(saitama, m) {
  await withErrorReply(saitama, m, 'IP lookup', async () => {
    const json = await apiGetAny(config.api.endpoints.ip);
    const body = unwrap(json);
    const lines = typeof body === 'object' && body
      ? Object.entries(body).map(([k, v]) => `*${k}*: ${v}`)
      : [String(body)];
    await reply(saitama, m, `🌐 *IP Info*\n\n${lines.join('\n')}`);
  });
}

async function handleInfo(saitama, m, url) {
  if (!url) return reply(saitama, m, `Usage: ${config.prefix}info <link>`);
  await withErrorReply(saitama, m, 'Media info lookup', async () => {
    const json = await apiGetAny(config.api.endpoints.info, { url });
    const r = unwrap(json) || {};
    const title = findFirstValue(r, ['title', 'name']) || 'Untitled';
    const author = findFirstValue(r, ['author', 'uploader', 'creator', 'channel']);
    const desc = findFirstValue(r, ['description', 'caption', 'text']);
    const caption = `ℹ️ *${title}*${author ? `\n👤 ${author}` : ''}${desc ? `\n\n${desc}` : ''}`;
    const thumbnail = findFirstValue(r, ['thumbnail', 'thumbnail_url', 'thumbnailUrl', 'thumb']);
    if (thumbnail) {
      const buf = await fetchBuffer(thumbnail);
      await replyImage(saitama, m, buf, caption);
    } else {
      await reply(saitama, m, caption);
    }
  });
}

async function handleDownload(saitama, m, url, { paths, label, kind }) {
  if (!url) return reply(saitama, m, `Usage: ${config.prefix}${label.toLowerCase()} <link>`);
  await withErrorReply(saitama, m, `${label} download`, async () => {
    await doReact(saitama, m, '⏳');
    const media = await apiGetMediaAny(paths, { url });
    let buffer = media.buffer;
    const json = media.json;

    // The current Replit API streams the file directly. Older deployments
    // returned JSON containing a temporary media URL, so preserve support for
    // both response contracts.
    if (!buffer && json) {
      const mediaUrl = extractMediaUrl(json);
      if (mediaUrl) buffer = await fetchBuffer(mediaUrl);
    }
    if (!buffer || !buffer.length) {
      await reply(saitama, m, `The API returned an empty media response.`);
      return;
    }

    const title = extractTitle(json) || media.fileName || label;
    if (kind === 'audio') {
      await replyAudio(saitama, m, buffer, safeFileName(title, 'mp3'));
    } else {
      await replyVideo(saitama, m, buffer, `🎬 ${title}`);
    }
    await doReact(saitama, m, '✅');
  });
}

async function handleSearch(saitama, m, query) {
  if (!query) return reply(saitama, m, `Usage: ${config.prefix}yt <search terms>`);
  await withErrorReply(saitama, m, 'YouTube search', async () => {
    const json = await apiGetAny(config.api.endpoints.search, { q: query, limit: 5 });
    const r = unwrap(json);
    const results = Array.isArray(r)
      ? r
      : (r && Array.isArray(r.results) ? r.results
        : Array.isArray(r?.items) ? r.items
          : Array.isArray(json?.results) ? json.results : []);
    if (!results.length) {
      await reply(saitama, m, `No results for "${query}".`);
      return;
    }
    const lines = results.slice(0, 5).map((item, i) => {
      const title = item.title || item.name || 'Untitled';
      const link = item.url || item.link || item.videoUrl || '';
      const dur = item.duration ? ` (${item.duration})` : '';
      return `${i + 1}. *${title}*${dur}\n${link}`;
    });
    await reply(saitama, m, `🔎 *YouTube results for "${query}"*\n\n${lines.join('\n\n')}`);
  });
}

const TOOL_COMMANDS = {
  ip: (saitama, m) => handleIp(saitama, m),
  info: (saitama, m, argStr) => handleInfo(saitama, m, argStr),
  audio: (saitama, m, argStr) => handleDownload(saitama, m, argStr, {
    paths: config.api.endpoints.audio, label: 'Audio', kind: 'audio'
  }),
  video: (saitama, m, argStr) => handleDownload(saitama, m, argStr, {
    paths: config.api.endpoints.video, label: 'Video', kind: 'video'
  }),
  tiktok: (saitama, m, argStr) => handleDownload(saitama, m, argStr, {
    paths: config.api.endpoints.tiktok, label: 'TikTok', kind: 'video'
  }),
  tt: (saitama, m, argStr) => handleDownload(saitama, m, argStr, {
    paths: config.api.endpoints.tiktok, label: 'TikTok', kind: 'video'
  }),
  search: (saitama, m, argStr) => handleSearch(saitama, m, argStr),
  yt: (saitama, m, argStr) => handleSearch(saitama, m, argStr)
};

async function handleToolCommand(saitama, m, text) {
  const raw = (text || '').trim();
  if (!raw.startsWith(config.prefix)) return false;

  const body = raw.slice(config.prefix.length).trim();
  const [cmd, ...rest] = body.split(/\s+/);
  const key = (cmd || '').toLowerCase();

  if (key === 'tools') {
    await reply(saitama, m,
      `╭━━━〔 SAITAMA TOOLS 〕━━━╮\n` +
      `│ ${config.prefix}ip — IP lookup\n` +
      `│ ${config.prefix}info <link> — media info\n` +
      `│ ${config.prefix}audio <link> — MP3 download\n` +
      `│ ${config.prefix}video <link> — MP4 download\n` +
      `│ ${config.prefix}tiktok <link> — no watermark\n` +
      `│ ${config.prefix}yt <query> — YouTube search\n` +
      `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
      `Supported: TikTok · YouTube · Instagram · X · Facebook · Reddit · SoundCloud · Vimeo`
    );
    return true;
  }

  const handler = TOOL_COMMANDS[key];
  if (!handler) return false;

  const argStr = rest.join(' ').trim();
  await handler(saitama, m, argStr);
  return true;
}

module.exports = { handleToolCommand };
