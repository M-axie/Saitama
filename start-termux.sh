#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BOT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required. Install them in Termux with:"
  echo "pkg update && pkg install nodejs"
  exit 1
fi

if [ ! -d node_modules ] || [ ! -d node_modules/@whiskeysockets/baileys ]; then
  echo "Installing bot dependencies..."
  npm install --no-audit --no-fund
fi

exec npm start
