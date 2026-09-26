/**
 * Shared messaging helpers, following the V1 convention:
 *   - `saitama` is the active Baileys socket
 *   - reply(m, text) sends a text reply into the same chat
 *   - replyImage(m, buffer, caption) sends a rendered board
 *   - doReact(m, emoji) reacts to the triggering message
 */

async function reply(saitama, m, text) {
  return saitama.sendMessage(m.key.remoteJid, { text }, { quoted: m });
}

async function replyImage(saitama, m, buffer, caption = '') {
  return saitama.sendMessage(
    m.key.remoteJid,
    { image: buffer, caption },
    { quoted: m }
  );
}

async function replyVideo(saitama, m, buffer, caption = '') {
  return saitama.sendMessage(
    m.key.remoteJid,
    { video: buffer, caption },
    { quoted: m }
  );
}

async function replyAudio(saitama, m, buffer, fileName = 'audio.mp3') {
  return saitama.sendMessage(
    m.key.remoteJid,
    { audio: buffer, mimetype: 'audio/mpeg', fileName, ptt: false },
    { quoted: m }
  );
}

async function replyDocument(saitama, m, buffer, fileName, mimetype = 'application/octet-stream') {
  return saitama.sendMessage(
    m.key.remoteJid,
    { document: buffer, fileName, mimetype },
    { quoted: m }
  );
}

async function doReact(saitama, m, emoji) {
  return saitama.sendMessage(m.key.remoteJid, {
    react: { text: emoji, key: m.key }
  });
}

module.exports = { reply, replyImage, replyVideo, replyAudio, replyDocument, doReact };
