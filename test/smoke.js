const assert = require('node:assert/strict');
const config = require('../config');
const { CATALOG, catalogText } = require('../handlers/commands/helpcommands');
const { handleFeatureCommand } = require('../handlers/commands/featurecommands');

assert.ok(catalogText({ user: { name: 'ur_us' } }, { key: { remoteJid: 'smoke@s.whatsapp.net' } }).includes('*_AI_*'));
assert.ok(Object.values(CATALOG).flat().includes('restart'));
assert.equal(config.api.endpoints.aiChat[0], '/api/tools/ai/chat');

const sent = [];
const socket = { sendMessage: async (jid, payload) => { sent.push({ jid, payload }); } };
const message = { key: { remoteJid: 'smoke@s.whatsapp.net' } };

(async () => {
  assert.equal(await handleFeatureCommand(socket, message, '!ping'), true);
  assert.match(sent.pop().payload.text, /Pong/);
  assert.equal(await handleFeatureCommand(socket, message, '!chatbot'), true);
  assert.match(sent.pop().payload.text, /currently/);
  assert.equal(await handleFeatureCommand(socket, message, '!restart'), true);
  assert.match(sent.pop().payload.text, /owner-only/);
  assert.equal(await handleFeatureCommand(socket, message, '!settings'), true);
  assert.match(sent.pop().payload.text, /Auto AI replies/);
  console.log('smoke tests passed');
})();
