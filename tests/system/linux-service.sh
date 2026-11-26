#!/usr/bin/env bash
set -euo pipefail

if [[ ${GITHUB_ACTIONS:-} != true || ${RUNNER_OS:-} != Linux || -z ${RUNNER_TEMP:-} ]]; then
  printf '%s\n' 'Use the disposable GitHub Actions Linux runner for the installed service test.' >&2
  exit 1
fi

service=edu-promaic
unit=/etc/systemd/system/$service.service
configuration=/etc/$service
credentials=$configuration/credentials
installation=/opt/$service
state=/var/lib/$service
node_bin=$(command -v node)
tls_name=classroom-backend.example.test

for path in "$unit" "$unit.d" "$configuration" "$installation" "$state"; do
  if sudo test -e "$path" || sudo test -L "$path"; then
    printf 'Fixture path already exists: %s\n' "$path" >&2
    exit 1
  fi
done
if getent passwd "$service" >/dev/null || getent group "$service" >/dev/null; then
  printf 'Fixture account already exists: %s\n' "$service" >&2
  exit 1
fi

fixture=$(mktemp -d "$RUNNER_TEMP/$service.XXXXXXXX")
cleanup() {
  result=$?
  trap - EXIT
  if (( result != 0 )); then
    sudo journalctl -u "$service" --no-pager -n 30 || true
  fi
  sudo systemctl stop "$service" || true
  sudo rm -rf -- "$unit" "$unit.d" "$configuration" "$installation" "$state"
  sudo systemctl daemon-reload || true
  sudo userdel "$service" || true
  rm -rf -- "$fixture"
  exit "$result"
}
trap cleanup EXIT

umask 077
mkdir "$fixture/release"
cp -R code scripts package.json package-lock.json "$fixture/release/"
(cd "$fixture/release" && npm ci --ignore-scripts --omit=dev)

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$tls_name" \
  -addext "subjectAltName=DNS:$tls_name" -keyout "$fixture/tls-key.pem" -out "$fixture/tls-cert.pem" 2>/dev/null
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$fixture/identity-key.pem" 2>/dev/null
openssl pkey -in "$fixture/identity-key.pem" -pubout -out "$fixture/identity.pem"
openssl rand -base64 32 > "$fixture/store-key"
openssl rand -base64 32 > "$fixture/audit-key"

sudo useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$service"
sudo install -d -m 0755 "$installation" "$installation/releases" "$installation/releases/test"
sudo cp -R "$fixture/release/." "$installation/releases/test/"
sudo chown -R root:root "$installation"
sudo chmod -R a+rX,go-w "$installation/releases/test"
sudo ln -s "$installation/releases/test" "$installation/current"
sudo install -d -o root -g "$service" -m 0750 "$configuration"
sudo install -d -o root -g root -m 0700 "$credentials"
sudo install -o root -g "$service" -m 0640 deployment/linux/classroom.example.json "$configuration/classroom.json"
sudo install -o root -g "$service" -m 0640 "$fixture/identity.pem" "$configuration/identity-public.pem"
sudo install -o root -g "$service" -m 0640 "$fixture/tls-cert.pem" "$configuration/tls-chain.pem"
sudo install -o root -g root -m 0600 "$fixture/tls-key.pem" "$credentials/tls-private.pem"
sudo install -o root -g root -m 0600 "$fixture/store-key" "$fixture/audit-key" "$credentials/"
sudo install -o root -g root -m 0644 "deployment/linux/$service.service" "$unit"

node_major='process.versions.node.split(".")[0]'
runner_major=$("$node_bin" -p "$node_major")
if [[ ! -x /usr/bin/node ]] || [[ $(/usr/bin/node -p "$node_major") != "$runner_major" ]]; then
  sudo install -d -o root -g root -m 0755 "$unit.d"
  printf '[Service]\nExecStart=\nExecStart="%s" code/backend/server.js\n' "$node_bin" |
    sudo tee "$unit.d/runner-node.conf" >/dev/null
fi

sudo systemctl daemon-reload
sudo systemctl start "$service"
request=(
  curl --silent --show-error --noproxy '*' --cacert "$fixture/tls-cert.pem"
  --resolve "$tls_name:3443:127.0.0.1" --connect-timeout 2 --max-time 5
)
origin="https://$tls_name:3443"
health=$("${request[@]}" --fail --retry 5 --retry-delay 1 --retry-connrefused "$origin/api/health")
"$node_bin" -e 'require("node:assert/strict").equal(JSON.parse(process.argv[1]).status, "ok")' "$health"

pid=$(systemctl show "$service" --property MainPID --value)
[[ $(ps -o uid= -p "$pid" | awk '{print $1}') == "$(id -u "$service")" ]]
[[ $(sudo awk '/^NoNewPrivs:/ {print $2}' "/proc/$pid/status") == 1 ]]
[[ $(ss -H -ltn 'sport = :3443' | awk '{print $4}') == 127.0.0.1:3443 ]]
[[ $(sudo stat --format '%a %U %G' "$state") == "700 $service $service" ]]

status=$("${request[@]}" --output /dev/null --dump-header "$fixture/response.headers" \
  --write-out '%{http_code}' "$origin/api/classroom")
[[ $status == 401 ]]
grep -qi '^WWW-Authenticate: Bearer' "$fixture/response.headers"
request_id=$(awk 'tolower($1) == "x-request-id:" { sub(/\r$/, "", $2); print $2 }' "$fixture/response.headers")
[[ $(sudo stat --format '%a %U %G' "$state/access-audit.json") == "600 $service $service" ]]
checkpoint=$(sudo env CLASSROOM_AUDIT_KEY_FILE="$credentials/audit-key" \
  "$node_bin" "$installation/current/scripts/classroom-audit.js" verify --file "$state/access-audit.json")
"$node_bin" -e 'require("node:assert/strict").equal(JSON.parse(process.argv[1]).sequence, 1)' "$checkpoint"
sudo cat "$state/access-audit.json" | "$node_bin" -e '
  const assert = require("node:assert/strict");
  const { records: [first] } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const requestId = process.argv[1];
  assert.match(requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  assert.equal(first.action, "lesson.read");
  assert.equal(first.outcome, "denied");
  assert.equal(first.requestId, requestId);
' "$request_id"

sudo systemctl stop "$service"
printf '%s\n' 'Installed systemd service passed HTTPS, loopback, privilege, storage permission, and signed audit checks.'
