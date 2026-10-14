#!/usr/bin/env bash
# Private Vercel deploy: uploads only the built site (never downloads/, tools/, the SWF or extracted scripts)
# as a *preview* deployment. Preview URLs sit behind Vercel Authentication (Standard Protection),
# so only you (logged into Vercel) can open them.
# Production domains (reverse-eg-slap.vercel.app) are PUBLIC under Standard Protection — never pass --prod.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build
rm -rf .vercel/output
mkdir -p .vercel/output/static
cp -R dist/. .vercel/output/static/
echo '{"version":3}' > .vercel/output/config.json

out=$(npx vercel deploy --prebuilt --yes --target preview --format json 2>/dev/null)
read -r url target <<<"$(python3 -I -c 'import json,sys; d=json.load(sys.stdin); d=d.get("deployment",d); print(d["url"], d.get("target") or "preview")' <<<"$out")"
case "$url" in https://*) ;; *) url="https://$url" ;; esac
echo "$url (target: $target)"

fail() {
  echo "!! $1 — removing $url" >&2
  npx vercel remove "$url" --yes >&2
  exit 1
}

# Must be a preview, and an unauthenticated request must not get the page
[ "$target" = "production" ] && fail "deployment landed on production (public domain)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
[ "$code" = "200" ] && fail "$url is publicly reachable (HTTP 200)"
echo "OK: unauthenticated request got HTTP $code (protected). Open it while logged into Vercel."
