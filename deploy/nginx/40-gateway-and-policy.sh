#!/bin/sh
# Run by nginx's image entrypoint before nginx starts. It turns the image's settings into two files the server
# includes: how /bee reaches the gateway, and the headers every page answer carries, its content security policy
# among them. A setting that is missing or malformed stops the container here, with the reason, rather than serving
# a page that cannot load its streams.
#
# GATEWAY_MODE    proxy (default): the page reads the gateway at /bee on its own origin, and nginx forwards there.
#                 direct: the page reads the gateway at its own address, which config.json names as gatewayUrl.
# BEE_GATEWAY_URL The gateway's address, such as https://gateway.example.com. In proxy mode nginx forwards /bee to
#                 it. In direct mode the policy lets the page reach it.
# CHAT_READ_URL   The chat's read endpoint, which config.json names as chat.readUrl. Optional, and allowed by the
#                 policy when set.
# CHAT_WRITE_URL  The chat's write endpoint, which config.json names as chat.writeUrl. The same.
# EXTRA_GATEWAY_URLS  Optional. The addresses of the further gateways config.json offers in providers.gateways,
#                 separated by spaces. The policy lets the page reach each of them, in either mode.
# BEE_NODES       Which Bee nodes of their own a viewer may watch through, beside the gateways above.
#                 off (default): only a node on the viewer's own machine, at localhost or 127.0.0.1.
#                 https: also a node on any https address, such as one on another machine behind TLS.
#                 https-and-local-http: also a node at a plain http address, which is how a node on the viewer's
#                 local network is reached. A policy cannot name private address ranges, so this lets the page reach
#                 every plain http address, and Chrome then asks the viewer before the page reaches their network.
set -eu

OUT_DIR="${STREAM_CLIENT_NGINX_DIR:-/etc/nginx/stream-event-client}"
MODE="${GATEWAY_MODE:-proxy}"
BEE_NODES="${BEE_NODES:-off}"

refuse() {
  echo "stream-event-client: $1" >&2
  exit 1
}

# An origin and nothing else: a scheme, a host and an optional port, with no path, query or space.
origin_of() {
  value="${2%/}"
  if ! printf '%s' "$value" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
    refuse "$1 must be an address such as https://gateway.example.com, with no path. It is \"$2\"."
  fi
  printf '%s' "$value"
}

[ -n "${BEE_GATEWAY_URL:-}" ] || refuse "BEE_GATEWAY_URL is not set. It names the Bee gateway the streams are read from."
GATEWAY="$(origin_of BEE_GATEWAY_URL "$BEE_GATEWAY_URL")"
[ -z "${CHAT_BEE_URL:-}" ] || refuse "CHAT_BEE_URL is replaced by CHAT_READ_URL and CHAT_WRITE_URL."
CHAT_SOURCE=""
for setting in CHAT_READ_URL CHAT_WRITE_URL; do
  value="$(printenv "$setting" || true)"
  if [ -n "$value" ]; then
    CHAT_SOURCE="$CHAT_SOURCE $(origin_of "$setting" "$value")"
  fi
done

EXTRA_SOURCE=""
# The list is split on spaces unquoted, so globbing is off while it is, or a stray * would expand to file names.
set -f
for value in ${EXTRA_GATEWAY_URLS:-}; do
  EXTRA_SOURCE="$EXTRA_SOURCE $(origin_of EXTRA_GATEWAY_URLS "$value")"
done
set +f

# The scheme sources a node a viewer picks may be reached under, beyond their own machine.
case "$BEE_NODES" in
  off) BEE_NODE_SOURCE="" ;;
  https) BEE_NODE_SOURCE=" https:" ;;
  https-and-local-http) BEE_NODE_SOURCE=" https: http:" ;;
  *) refuse "BEE_NODES must be off, https or https-and-local-http. It is \"$BEE_NODES\"." ;;
esac

mkdir -p "$OUT_DIR"

case "$MODE" in
  proxy)
    GATEWAY_SOURCE=""
    cat > "$OUT_DIR/gateway.conf" <<CONF
# Written at start for GATEWAY_MODE=proxy. The page reads the gateway here, on its own origin. Only reads pass, so
# this origin cannot be used to write to the gateway.
location /bee/ {
  limit_except GET { deny all; }
  proxy_pass $GATEWAY/;
  proxy_http_version 1.1;
  proxy_ssl_server_name on;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
  # Segments stream through as they arrive rather than waiting in nginx.
  proxy_buffering off;
}
CONF
    ;;
  direct)
    GATEWAY_SOURCE=" $GATEWAY"
    cat > "$OUT_DIR/gateway.conf" <<CONF
# Written at start for GATEWAY_MODE=direct. The page reads the gateway at its own address, so /bee is not served, and
# a config.json still naming /bee gets a plain 404 rather than the page itself.
location /bee/ {
  return 404;
}
CONF
    ;;
  *)
    refuse "GATEWAY_MODE must be proxy or direct. It is \"$MODE\"."
    ;;
esac

# A viewer may pick a Bee node on their own machine, at any port, which the page reads over plain http.
OWN_NODE="http://localhost:* http://127.0.0.1:*"

# Inline styles are allowed because the emoji picker writes its own style element. hls.js runs in a worker it builds
# from a blob, and plays through blob URLs.
POLICY="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'"
POLICY="$POLICY; img-src 'self' data: blob:$GATEWAY_SOURCE$EXTRA_SOURCE $OWN_NODE$BEE_NODE_SOURCE"
POLICY="$POLICY; media-src 'self' blob:; worker-src 'self' blob:"
POLICY="$POLICY; connect-src 'self'$GATEWAY_SOURCE$EXTRA_SOURCE$CHAT_SOURCE $OWN_NODE$BEE_NODE_SOURCE"
POLICY="$POLICY; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"

cat > "$OUT_DIR/headers.conf" <<CONF
# Written at start. Included in every location that sets headers of its own, because nginx drops the server's
# add_header lines in a location that has any.
add_header Content-Security-Policy "$POLICY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
CONF

echo "stream-event-client: gateway $MODE at $GATEWAY${EXTRA_SOURCE:+, extra gateways$EXTRA_SOURCE}${CHAT_SOURCE:+, chat endpoints$CHAT_SOURCE}${BEE_NODE_SOURCE:+, Bee nodes $BEE_NODES}"
