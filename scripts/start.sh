#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f config.js ]]; then
  echo "Copy config.example.js to config.js and configure MySQL, publicUrl, port and sessionSecret."
  exit 1
fi
# Never use git reset --hard or git clean: local configuration must survive.
node scripts/update.js
npm ci --omit=dev --ignore-scripts
npm run check
npm test
node scripts/migrate.js
exec node server.js
