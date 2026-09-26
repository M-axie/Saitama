const assert = require('assert');
const os = require('os');
const path = require('path');

// Use an isolated, throwaway database for this run so toggled flags (like
// antilink below) don't persist into the next `npm test` run and make the
// "default state" assertions fail the second time the suite is executed.
process.env.SAITAMA_DATABASE_PATH = path.join(
  os.tmpdir(), `saitama-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
);

const config = require('../config');
const { handleFeatureCommand } = require('../handlers/commands/featurecommands');

const sent = [];
const socket = {
  user: { id: '27700000000:12@s.whatsapp.net' }, // bot's own JID, device-suffixed like real Baileys
  sendMessage: async (jid, payload) => { sent.push({ jid, payload }); },
  groupMetadata: async () => ({ subject: 'Test Group', desc: 'A test group', participants: [] }),
  chatModify: async () => {},
  groupToggleEphemeral: async () => {},
  onWhatsApp: async () => [{ exists: true }],
  sendPresenceUpdate: async () => {}
};

// Owner message, so owner-only/admin-only commands pass their guard.
const ownerMessage = { key: { remoteJid: config.ownerJid, participant: config.ownerJid, fromMe: false } };
const groupMessage = { key: { remoteJid: '123-456@g.us', participant: config.ownerJid, fromMe: false } };
const groupChatMessage = (contextInfo) => ({
  key: { remoteJid: '123-456@g.us', participant: '27788888888@s.whatsapp.net', fromMe: false },
  message: { extendedTextMessage: { text: 'hey there', contextInfo } }
});

(async () => {
  // per-chat toggle: default state, then flip it, then confirm it persisted
  assert.equal(await handleFeatureCommand(socket, groupMessage, '!antilink'), true);
  assert.match(sent.pop().payload.text, /currently \*OFF\*/);
  assert.equal(await handleFeatureCommand(socket, groupMessage, '!antilink on'), true);
  assert.match(sent.pop().payload.text, /now \*ON\*/);
  assert.equal(await handleFeatureCommand(socket, groupMessage, '!antilink'), true);
  assert.match(sent.pop().payload.text, /currently \*ON\*/);

  // bot-wide presence toggle
  assert.equal(await handleFeatureCommand(socket, ownerMessage, '!alwaysonline on'), true);
  assert.match(sent.pop().payload.text, /now \*ON\*/);
  assert.equal(await handleFeatureCommand(socket, ownerMessage, '!presence'), true);
  assert.match(sent.pop().payload.text, /Always-online: ON/);

  // real group/account actions against the mocked socket
  assert.equal(await handleFeatureCommand(socket, groupMessage, '!disappear 24h'), true);
  assert.match(sent.pop().payload.text, /Disappearing messages set to 24h/);
  assert.equal(await handleFeatureCommand(socket, groupMessage, '!groupstatus'), true);
  assert.match(sent.pop().payload.text, /Test Group/);
  assert.equal(await handleFeatureCommand(socket, groupMessage, '!checkon 27799355427'), true);
  assert.match(sent.pop().payload.text, /is on WhatsApp/);

  // group chatbot gating: a plain message ignored unless the bot is
  // @mentioned or the message replies to one of the bot's own messages
  assert.equal(await handleFeatureCommand(socket, groupChatMessage(undefined), 'hey there'), false);
  assert.equal(
    await handleFeatureCommand(socket, groupChatMessage({ mentionedJid: ['27700000000@s.whatsapp.net'] }), 'hey there'),
    true
  );
  assert.equal(
    await handleFeatureCommand(socket, groupChatMessage({ participant: '27700000000@s.whatsapp.net' }), 'hey there'),
    true
  );

  console.log('new-commands smoke tests passed');
})();
