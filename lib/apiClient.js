const config = require('../config');

function apiBaseUrls() {
  return [...new Set([config.api.baseUrl, ...(config.api.fallbackBaseUrls || [])].filter(Boolean))];
}

function parseFileName(contentDisposition) {
  const match = contentDisposition?.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)/i);
  return match ? decodeURIComponent(match[1].replace('"', '')) : null;
}

function parseJson(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return { raw }; }
}

async function apiRequest(path, params = {}, { baseUrl = config.api.baseUrl, responseType = 'json', method = 'GET', body } = {}) {
  const url = new URL(path, baseUrl);
  if (method === 'GET') for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  const res = await fetch(url, {
    method,
    headers: { Accept: responseType === 'buffer' ? '*/*' : 'application/json', 'Content-Type': 'application/json', 'X-API-Key': config.api.apiKey },
    body: method === 'GET' ? undefined : JSON.stringify(body || params),
    signal: AbortSignal.timeout(responseType === 'buffer' ? config.api.downloadTimeoutMs : config.api.timeoutMs)
  });
  const contentType = res.headers.get('content-type') || '';
  const bodyBuffer = Buffer.from(await res.arrayBuffer());
  const raw = bodyBuffer.toString('utf8');
  if (!res.ok) { const err = new Error(`saitama-api ${path} returned ${res.status}`); err.status = res.status; err.body = parseJson(raw); throw err; }
  if (contentType.includes('text/html') || /^\s*<!doctype html/i.test(raw)) { const err = new Error('Saitama API returned an HTML page instead of JSON'); err.code = 'API_HTML_RESPONSE'; throw err; }
  if (responseType === 'buffer' && !contentType.includes('json') && !contentType.includes('text/')) return { buffer: bodyBuffer, contentType, fileName: parseFileName(res.headers.get('content-disposition')) };
  return responseType === 'buffer' ? { json: parseJson(raw), contentType } : parseJson(raw);
}

function shouldTryNextApi(err) { return [404, 405, 429, 502, 503, 504].includes(err.status) || err.code === 'API_HTML_RESPONSE' || ['TypeError', 'AbortError', 'TimeoutError'].includes(err.name); }
async function apiGet(path, params = {}, options = {}) { return apiRequest(path, params, options); }
async function apiPost(path, body = {}, options = {}) { return apiRequest(path, {}, { ...options, method: 'POST', body }); }
async function apiGetAny(paths, params = {}) { let last; for (const baseUrl of apiBaseUrls()) for (const path of [].concat(paths)) try { return await apiGet(path, params, { baseUrl }); } catch (err) { last = err; if (!shouldTryNextApi(err)) throw err; } throw last || new Error('No API endpoint configured'); }
async function apiPostAny(paths, body = {}) { let last; for (const baseUrl of apiBaseUrls()) for (const path of [].concat(paths)) try { return await apiPost(path, body, { baseUrl }); } catch (err) { last = err; if (!shouldTryNextApi(err)) throw err; } throw last || new Error('No API endpoint configured'); }
async function apiGetMediaAny(paths, params = {}) { let last; for (const baseUrl of apiBaseUrls()) for (const path of [].concat(paths)) try { const result = await apiGet(path, params, { baseUrl, responseType: 'buffer' }); if (result.buffer?.length || result.json) return result; } catch (err) { last = err; if (!shouldTryNextApi(err)) throw err; } throw last || new Error('No API endpoint configured'); }
async function fetchBuffer(mediaUrl) {
  if (String(mediaUrl).startsWith('data:')) { const match = String(mediaUrl).match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i); if (!match) throw new Error('Invalid data URL'); return match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])); }
  const parsed = new URL(mediaUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported media URL'); const res = await fetch(parsed, { signal: AbortSignal.timeout(config.api.downloadTimeoutMs) }); if (!res.ok) throw new Error(`Media download failed: ${res.status}`); return Buffer.from(await res.arrayBuffer());
}

module.exports = { apiGet, apiPost, apiGetAny, apiPostAny, apiGetMediaAny, fetchBuffer };
