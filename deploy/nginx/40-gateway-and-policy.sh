#!/bin/sh
# Run by nginx's image entrypoint before nginx starts. It turns the image's settings into three files the server
# includes: how /bee reaches the gateway, the headers every page answer carries, its content security policy among
# them, and who else may fetch the page's font files. A setting that is missing or malformed stops the container
# here, with the reason, rather than serving a page that cannot load its streams.
#
# The page decides which kinds of source a viewer may add, and the policy allows every one of them whatever the
# deployment: any gateway at an https address, a Bee node on the viewer's own machine or at an https address, and the
# Swarm node in the viewer's browser, weeb-3, which compiles WebAssembly and dials its peers over secure websockets,
# and the Freedom browser's own node, whose content the page loads at bzz:// URLs.
#
# GATEWAY_MODE    proxy (default): the page reads the gateway at /bee on its own origin, and nginx forwards there.
#                 direct: the page reads the gateway at its own address, which config.json names as gatewayUrl.
# BEE_GATEWAY_URL The gateway's address, such as https://gateway.example.com. In proxy mode nginx forwards /bee to
#                 it. In direct mode the page reads it, which the policy allows already at https, and by name at http.
# CHAT_READ_URL   The chat's read endpoint, which config.json names as chat.readUrl. Optional. The policy allows it by
#                 name when it is plain http.
# CHAT_WRITE_URL  The chat's write endpoint, which config.json names as chat.writeUrl. The same.
# EXTRA_GATEWAY_URLS  Optional. The addresses of the further gateways config.json offers in providers.gateways,
#                 separated by spaces. Each is checked, and the policy names the plain http ones, since it allows
#                 every https address already.
# SWARM_ID_URL    Optional. The Swarm ID site a viewer signs in to the chat with, which config.json names as
#                 swarmId.url. The policy lets the page frame that one site, because the library talks to it through a
#                 hidden frame of that site. Its window opens as a window of its own, which the policy does not govern.
#                 In proxy mode /bee also lets that one site read it, since the frame reads this site's content through
#                 /bee from its own origin. A chat read endpoint on another host has to allow that site itself.
#                 The page's font files let that one site fetch them too, since Swarm ID's button frame draws its label
#                 in the page's own typeface and loads the file from its own origin.
set -eu

OUT_DIR="${STREAM_CLIENT_NGINX_DIR:-/etc/nginx/stream-event-client}"
MODE="${GATEWAY_MODE:-proxy}"

refuse() {
  echo "stream-event-client: $1" >&2
  exit 1
}

NEWLINE='
'
CARRIAGE_RETURN="$(printf '\r')"

# An origin and nothing else: a scheme, a host and an optional port, with no path, query or space. grep tests each
# line on its own, so a value of two lines is refused first, or one good line would pass the other with it.
origin_of() {
  case "$2" in
    *"$NEWLINE"* | *"$CARRIAGE_RETURN"*) refuse "$1 must be one address on one line, with no line break in it." ;;
  esac
  value="${2%/}"
  if ! printf '%s' "$value" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
    refuse "$1 must be an address such as https://gateway.example.com, with no path. It is \"$2\"."
  fi
  printf '%s' "$value"
}

# The source the policy names an origin by, which is none for an https one, since https: allows it already.
named_if_http() {
  case "$1" in
    http://*) printf ' %s' "$1" ;;
  esac
}

[ -n "${BEE_GATEWAY_URL:-}" ] || refuse "BEE_GATEWAY_URL is not set. It names the Bee gateway the streams are read from."
GATEWAY="$(origin_of BEE_GATEWAY_URL "$BEE_GATEWAY_URL")"
[ -z "${CHAT_BEE_URL:-}" ] || refuse "CHAT_BEE_URL is replaced by CHAT_READ_URL and CHAT_WRITE_URL."
CHAT_ORIGINS=""
CHAT_SOURCE=""
for setting in CHAT_READ_URL CHAT_WRITE_URL; do
  value="$(printenv "$setting" || true)"
  if [ -n "$value" ]; then
    origin="$(origin_of "$setting" "$value")"
    CHAT_ORIGINS="$CHAT_ORIGINS $origin"
    CHAT_SOURCE="$CHAT_SOURCE$(named_if_http "$origin")"
  fi
done

SWARM_ID_DIRECTIVE=""
SWARM_ID=""
if [ -n "${SWARM_ID_URL:-}" ]; then
  # In lower case, because a browser sends the Swarm ID frame's Origin so, and Access-Control-Allow-Origin is compared
  # with it exactly. The scheme and the host name no case, so config.json's swarmId.url may keep its own spelling.
  SWARM_ID="$(origin_of SWARM_ID_URL "$SWARM_ID_URL")"
  SWARM_ID="$(printf '%s' "$SWARM_ID" | tr '[:upper:]' '[:lower:]')"
  SWARM_ID_DIRECTIVE="; frame-src $SWARM_ID"
fi

EXTRA_ORIGINS=""
EXTRA_SOURCE=""
# The list is split on spaces unquoted, so globbing is off while it is, or a stray * would expand to file names.
set -f
for value in ${EXTRA_GATEWAY_URLS:-}; do
  origin="$(origin_of EXTRA_GATEWAY_URLS "$value")"
  EXTRA_ORIGINS="$EXTRA_ORIGINS $origin"
  EXTRA_SOURCE="$EXTRA_SOURCE$(named_if_http "$origin")"
done
set +f

mkdir -p "$OUT_DIR"

case "$MODE" in
  proxy)
    GATEWAY_SOURCE=""
    SWARM_ID_CORS=""
    READ_METHODS="GET"
    if [ -n "$SWARM_ID" ]; then
      # limit_except picks its own configuration before the rewrite phase runs, so a method it refuses never reaches
      # the preflight answer below. OPTIONS passes it for that answer alone, which returns before the gateway is asked.
      READ_METHODS="GET OPTIONS"
      # The Swarm ID frame reads from its own origin, so it is a cross-origin reader of /bee, the one allowed. The
      # gateway's own CORS headers are replaced rather than repeated, because a second Allow-Origin fails the read. A
      # preflight is answered here, since the gateway would see a method that is not GET.
      SWARM_ID_CORS="
  if (\$request_method = OPTIONS) {
    add_header Access-Control-Allow-Origin \"$SWARM_ID\" always;
    add_header Access-Control-Allow-Methods \"GET\" always;
    add_header Access-Control-Allow-Headers \$http_access_control_request_headers always;
    add_header Access-Control-Max-Age 600 always;
    return 204;
  }
  proxy_hide_header Access-Control-Allow-Origin;
  proxy_hide_header Access-Control-Allow-Methods;
  proxy_hide_header Access-Control-Allow-Headers;
  proxy_hide_header Access-Control-Allow-Credentials;
  proxy_hide_header Access-Control-Expose-Headers;
  add_header Access-Control-Allow-Origin \"$SWARM_ID\" always;
  add_header Access-Control-Expose-Headers \"*\" always;
  include /etc/nginx/stream-event-client/headers.conf;"
    fi
    cat > "$OUT_DIR/gateway.conf" <<CONF
# Written at start for GATEWAY_MODE=proxy. The page reads the gateway here, on its own origin. Only reads pass, so
# this origin cannot be used to write to the gateway.
location /bee/ {$SWARM_ID_CORS
  limit_except $READ_METHODS { deny all; }
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
    GATEWAY_SOURCE="$(named_if_http "$GATEWAY")"
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

# A Bee node on the viewer's own machine, at any port, which the page reads over plain http.
OWN_NODE="http://localhost:* http://127.0.0.1:*"

# Inline styles are allowed because the emoji picker writes its own style element. hls.js runs in a worker it builds
# from a blob, and plays through blob URLs. weeb-3 compiles its WebAssembly module, and reaches every peer its network
# announces over a secure websocket. In the Freedom browser the page fetches segments from the browser's own node at
# bzz:// URLs and shows pictures from there, which no other source in the policy covers. The video still plays
# through blob URLs, so media-src needs no bzz:.
POLICY="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'"
POLICY="$POLICY; img-src 'self' data: blob:$GATEWAY_SOURCE$EXTRA_SOURCE https: bzz: $OWN_NODE"
POLICY="$POLICY; media-src 'self' blob:; worker-src 'self' blob:"
POLICY="$POLICY; connect-src 'self'$GATEWAY_SOURCE$EXTRA_SOURCE$CHAT_SOURCE https: wss: bzz: $OWN_NODE"
POLICY="$POLICY$SWARM_ID_DIRECTIVE; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"

if [ -n "$SWARM_ID" ]; then
  cat > "$OUT_DIR/fonts.conf" <<CONF
# Written at start with SWARM_ID_URL set. Swarm ID's button frame loads the page's font files from that one origin.
add_header Access-Control-Allow-Origin "$SWARM_ID" always;
CONF
else
  cat > "$OUT_DIR/fonts.conf" <<CONF
# Written at start with no SWARM_ID_URL, so no other site fetches the page's font files.
CONF
fi

cat > "$OUT_DIR/headers.conf" <<CONF
# Written at start. Included in every location that sets headers of its own, because nginx drops the server's
# add_header lines in a location that has any.
add_header Content-Security-Policy "$POLICY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
CONF

echo "stream-event-client: gateway $MODE at $GATEWAY${EXTRA_ORIGINS:+, extra gateways$EXTRA_ORIGINS}${CHAT_ORIGINS:+, chat endpoints$CHAT_ORIGINS}${SWARM_ID:+, Swarm ID $SWARM_ID}"
