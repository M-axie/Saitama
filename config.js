module.exports = {
  botName: 'Saitama V2',
  ownerJid: process.env.SAITAMA_OWNER_JID || '254799355427@s.whatsapp.net',
  sessionDir: './session',
  databasePath: process.env.SAITAMA_DATABASE_PATH || './data/saitama.sqlite',
  dashboard: {
    host: process.env.SAITAMA_DASHBOARD_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.SAITAMA_DASHBOARD_PORT || '8787', 10)
  },
  messaging: {
    autoView: process.env.SAITAMA_AUTOVIEW !== 'off',
    autoPresence: process.env.SAITAMA_AUTO_PRESENCE !== 'off'
  },
  sessionTimeoutMs: 10 * 60 * 1000,
  prefix: process.env.SAITAMA_PREFIX || '!',
  render: { width: 480, height: 640, deviceScaleFactor: 2 },
  ai: {
    // Primary AI provider: the free, no-API-key XCASPER SPACE "claude" endpoint.
    // Falls back to the Saitama API's own aiChat endpoint (config.api) if it errors.
    enabled: true,
    model: process.env.SAITAMA_AI_MODEL || 'gpt-4o-mini',
    temperature: Number.parseFloat(process.env.SAITAMA_AI_TEMPERATURE || '0.7'),
    maxTokens: Number.parseInt(process.env.SAITAMA_AI_MAX_TOKENS || '700', 10),
    maxHistory: Number.parseInt(process.env.SAITAMA_AI_MAX_HISTORY || '8', 10),
    timeoutMs: Number.parseInt(process.env.SAITAMA_AI_TIMEOUT_MS || '45000', 10),
    systemPrompt: process.env.SAITAMA_AI_SYSTEM_PROMPT ||
      'You are Saitama, a friendly, concise WhatsApp AI assistant. Be helpful, accurate, and safe. Use plain text formatting that works well in WhatsApp. Do not claim to have performed actions you cannot perform.',
    xcasper: {
      // No API key needed. GET <baseUrl><path>?query=<message> -> { data: { reply } }.
      // Set SAITAMA_XCASPER_AI_URL='' to disable and go straight to the saitama-api fallback.
      baseUrl: process.env.SAITAMA_XCASPER_AI_URL || 'https://apiz.xcasper.space',
      path: process.env.SAITAMA_XCASPER_AI_PATH || '/api/ai/claude'
    }
  },
  api: {
    baseUrl: process.env.SAITAMA_API_URL || 'https://saitama-hosting--iammaxie254.replit.app',
    fallbackBaseUrls: [process.env.SAITAMA_API_FALLBACK_URL || 'https://saitama-ai-wa-safety-bundle-puzknqt9z-iammaxie254-3802.vercel.app'],
    apiKey: process.env.SAITAMA_API_KEY || 'saitama-ai',
    timeoutMs: 15000,
    downloadTimeoutMs: 60000,
    endpoints: {
      ip: ['/api/tools/ip', '/api/utilities/ip'],
      info: ['/api/tools/info', '/api/utilities/info'],
      audio: ['/api/tools/download/audio', '/api/utilities/download/audio'],
      video: ['/api/tools/download/video', '/api/utilities/download/video'],
      tiktok: ['/api/tools/download/tiktok', '/api/utilities/download/tiktok'],
      search: ['/api/tools/search', '/api/utilities/search'],
      aiChat: ['/api/tools/ai/chat']
    }
  },
  pairing: {
    method: (process.env.SAITAMA_PAIR_METHOD || 'code').toLowerCase(),
    phoneNumber: process.env.SAITAMA_PHONE_NUMBER || '',
    customCode: process.env.SAITAMA_PAIR_CODE || 'URUSTECH'
  }
};
