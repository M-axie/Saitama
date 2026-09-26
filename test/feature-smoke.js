const assert = require('assert');
const { handleFeatureCommand } = require('../handlers/commands/featurecommands');

const sent = [];
const socket = { sendMessage: async (jid, payload) => { sent.push({ jid, payload }); } };
const message = { key: { remoteJid: 'feature-test@s.whatsapp.net' } };

(async () => {
  assert.equal(await handleFeatureCommand(socket, message, '!ping'), true);
  assert.match(sent.pop().payload.text, /Pong/);
  assert.equal(await handleFeatureCommand(socket, message, '!chatbot'), true);
  assert.match(sent.pop().payload.text, /currently/);
  assert.equal(await handleFeatureCommand(socket, message, '!chatbot off'), true);
  assert.match(sent.pop().payload.text, /OFF/);
  assert.equal(await handleFeatureCommand(socket, message, 'hello there'), false);
  assert.equal(await handleFeatureCommand(socket, message, '!chatbot on'), true);
  assert.match(sent.pop().payload.text, /ON/);
  assert.equal(await handleFeatureCommand(socket, message, '!settings'), true);
  assert.match(sent.pop().payload.text, /Auto AI replies/);
  assert.equal(await handleFeatureCommand(socket, message, '!restart'), true);
  assert.match(sent.pop().payload.text, /owner-only/);
  console.log('feature smoke tests passed');
})();
