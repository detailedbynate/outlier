#!/bin/bash
# Pull the latest main, rebuild, restart. This is the only thing the GitHub
# deploy key is allowed to run. Lives on the server at /usr/local/bin/outlier-deploy;
# this copy is the source of truth — update it here, then install it on the box.
set -euo pipefail
cd /opt/outlier
echo "== fetching =="
git fetch --quiet origin main
git reset --quiet --hard origin/main
git log --oneline -1
echo "== installing =="
npm ci --no-audit --no-fund --silent
echo "== building =="
npm run build 2>&1 | tail -5
chown -R outlier:outlier /opt/outlier
echo "== restarting =="
systemctl restart outlier
# The scraper runs the same checkout, so it needs restarting too or it keeps
# running the code from before this deploy. Skipped when it isn't installed.
if systemctl is-enabled --quiet outlier-scraper 2>/dev/null; then
  systemctl reset-failed outlier-scraper || true
  systemctl restart outlier-scraper
  echo "scraper: $(systemctl is-active outlier-scraper)"
fi
sleep 8
systemctl is-active outlier
curl -fsS -o /dev/null -w "site: %{http_code}\n" https://www.useoutlier.online/login
