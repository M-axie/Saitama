const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { CATALOG } = require('../handlers/commands/helpcommands');
const { enabled } = require('../lib/aiClient');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function json(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/status') {
      return json(res, {
        bot: config.botName,
        uptime: Math.floor(process.uptime()),
        commands: Object.values(CATALOG).flat().length,
        ai: enabled() ? 'ready' : 'not configured'
      });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    return json(res, { error: 'Not found' }, 404);
  } catch (err) {
    console.error('[dashboard] request failed:', err);
    return json(res, { error: 'Dashboard request failed' }, 500);
  }
});

function startDashboard() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.dashboard.port, config.dashboard.host, () => {
      console.log(`[dashboard] listening at http://${config.dashboard.host}:${config.dashboard.port}`);
      resolve(server);
    });
  });
}

if (require.main === module) startDashboard().catch((err) => { console.error(err); process.exit(1); });

module.exports = { server, startDashboard };
