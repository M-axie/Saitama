const config = require('../config');

const conversations = new Map();

function aiEndpoint() {
  const endpoint = config.api.endpoints.aiChat;
  return Array.isArray(endpoint) ? endpoint[0] : endpoint;
}

// AI is on as long as the feature flag is on and at least one provider is
// configured — the xcasper endpoint needs no key, so this is true out of
// the box even without a saitama-api deployment.
function enabled() {
  const hasXcasper = Boolean(config.ai.xcasper?.baseUrl && config.ai.xcasper?.path);
  const hasSaitamaApi = Boolean(config.api.baseUrl && config.api.apiKey && aiEndpoint());
  return Boolean(config.ai.enabled && (hasXcasper || hasSaitamaApi));
}

function trimHistory(history) {
  return history.slice(-Math.max(2, config.ai.maxHistory * 2));
}

function clear(jid) {
  conversations.delete(jid);
}

// The xcasper endpoint takes one flat `query` string with no separate
// history/system fields, and testing showed it ignores a `session` param
// (always reports back "default") — so it isn't keeping server-side
// conversation memory. Rather than guess at a transcript format it may not
// understand, each call there is a single fresh question; our own
// conversation history is still tracked locally (used by !clearchat and by
// the saitama-api fallback below, which does support a role-tagged prompt).
async function chatViaXcasper(prompt) {
  const { baseUrl, path } = config.ai.xcasper || {};
  if (!baseUrl || !path) throw new Error('xcasper AI endpoint is not configured.');
  const url = new URL(path, baseUrl);
  url.searchParams.set('query', prompt);
  const response = await fetch(url, { signal: AbortSignal.timeout(config.ai.timeoutMs) });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok || data?.success === false) {
    const detail = data?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(`xcasper AI error: ${detail}`);
  }
  const answer = String(data?.data?.reply || data?.reply || '').trim();
  if (!answer) throw new Error('xcasper AI returned an empty response.');
  return answer;
}

async function chatViaSaitamaApi(jid, prompt, context, history) {
  if (!config.api.baseUrl || !config.api.apiKey || !aiEndpoint()) {
    throw new Error('Saitama AI API is not configured.');
  }
  const conversation = [
    ...(context ? [{ role: 'system', content: context }] : []),
    ...history,
    { role: 'user', content: prompt }
  ];
  const url = new URL(aiEndpoint(), config.api.baseUrl);
  // The deployed API documents the `apikey` query parameter; retain the
  // header too because older Saitama API deployments use X-API-Key.
  url.searchParams.set('apikey', config.api.apiKey);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Key': config.api.apiKey
    },
    body: JSON.stringify({
      prompt: conversation.map((item) => `${item.role}: ${item.content}`).join('\n'),
      system: config.ai.systemPrompt,
      model: config.ai.model
    }),
    signal: AbortSignal.timeout(config.ai.timeoutMs)
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(`Saitama AI API error: ${detail}`);
  }
  const answer = String(data?.reply || data?.response || data?.result || data?.message || '').trim();
  if (!answer) throw new Error('Saitama AI API returned an empty response.');
  return answer;
}

async function chat(jid, prompt, context = '') {
  if (!enabled()) throw new Error('Saitama AI API is not configured.');
  const history = conversations.get(jid) || [];

  let answer;
  let xcasperError = null;
  try {
    answer = await chatViaXcasper(prompt);
  } catch (err) {
    xcasperError = err;
    try {
      answer = await chatViaSaitamaApi(jid, prompt, context, history);
    } catch (fallbackErr) {
      // Both providers failed — surface the xcasper error since it's the
      // primary path, but log the fallback failure too for debugging.
      console.error('[aiClient] saitama-api fallback also failed:', fallbackErr.message);
      throw xcasperError;
    }
  }

  conversations.set(jid, trimHistory([...history, { role: 'user', content: prompt }, { role: 'assistant', content: answer }]));
  return answer;
}

module.exports = { chat, clear, enabled };
