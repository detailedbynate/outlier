#!/bin/bash
# Pull the latest main, rebuild, restart. This is the only thing the GitHub
# deploy key is allowed to run. Lives on the server at /usr/local/bin/outlier-deploy;
# this copy is the source of truth — update it here, then install it on the box.
set -euo pipefail
cd /opt/outlier
echo "== fetching =="
before=$(git rev-parse HEAD)
git fetch --quiet origin main
git reset --quiet --hard origin/main
git log --oneline -1

# npm ci deletes node_modules and reinstalls everything, which is minutes of
# work. Dependencies only change when the lockfile does, so most deploys — a
# tweak to a page or a stylesheet — can skip it entirely.
if [ ! -d node_modules ] || ! git diff --quiet "$before" HEAD -- package-lock.json package.json; then
  echo "== installing (lockfile changed) =="
  npm ci --no-audit --no-fund --silent
  chown -R outlier:outlier node_modules
else
  echo "== installing == skipped, dependencies unchanged"
fi

echo "== building =="
npm run build 2>&1 | tail -5
# Everything but node_modules, which is already owned correctly and is by far
# the biggest thing here.
find /opt/outlier -maxdepth 1 -mindepth 1 ! -name node_modules -exec chown -R outlier:outlier {} +

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
