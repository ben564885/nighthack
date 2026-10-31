#!/bin/sh
# usage: ./deploy.sh   (copies the project to the droplet and restarts the hub)
# secrets live only in /opt/breadboard/.env on the server. this script never sends .env.
set -e
HOST="${DEPLOY_HOST:-root@138.68.238.172}"
cd "$(dirname "$0")"
rsync -az --delete --exclude node_modules --exclude .git --exclude .env --exclude .playwright-mcp \
  --exclude 'mac/SmartNotch.app' --exclude .photon-state.json ./ "$HOST:/opt/breadboard/"
ssh "$HOST" 'cd /opt/breadboard && chown -R breadboard:breadboard . && su breadboard -c "npm ci --omit=dev 2>&1 | tail -1" \
  && sed -i "s#^ExecStart=.*#ExecStart=/opt/breadboard/node_modules/.bin/tsx src/server.ts#" /etc/systemd/system/smart-breadboard.service \
  && systemctl daemon-reload && systemctl restart smart-breadboard && sleep 5 && systemctl is-active smart-breadboard'
curl -s -m 20 "https://breadboard.bennisevich.com/health"; echo
