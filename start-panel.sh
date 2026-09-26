#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BOT_DIR"

if [ ! -f package.json ]; then
  echo "ERROR: package.json was not found in $BOT_DIR"
  exit 1
fi

echo "[Saitama V2] directory: $BOT_DIR"
echo "[Saitama V2] Node: $(node --version)"
echo "[Saitama V2] npm: $(npm --version)"

if [ ! -d node_modules/@whiskeysockets/baileys ]; then
  echo "Installing Node.js dependencies..."
  npm install --omit=dev --no-audit --no-fund
fi

node -e "require.resolve('@whiskeysockets/baileys')" >/dev/null || {
  echo "ERROR: Baileys is still missing after npm install. Check the npm error above."
  exit 1
}

echo "Starting Saitama V2..."
exec npm start
