#!/usr/bin/env bash
#
# One-time, idempotent provisioning for the Life Logger home server (Arch Linux).
#
# Installs packages and the service account, creates directories, configures
# zram and lid behaviour, installs the systemd units, and creates the bare git
# repository and post-receive hook. Safe to run more than once.
#
# Run from the repository checkout with sudo:
#   sudo DEPLOY_USER="$USER" ./deploy/server-setup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root (sudo)." >&2
  exit 1
fi

if [ ! -f /etc/arch-release ]; then
  echo "This script targets Arch Linux; /etc/arch-release was not found." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_ROOT="${APP_ROOT:-/opt/lifelogger}"
DATA_DIR="${DATA_DIR:-/var/lib/lifelogger}"
ENV_FILE="${ENV_FILE:-/etc/lifelogger.env}"
SERVICE_NAME="${SERVICE_NAME:-lifelogger}"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-lifelogger}}"
EXPECTED_NODE_MAJOR="${EXPECTED_NODE_MAJOR:-24}"

REPO="$APP_ROOT/repo.git"
RELEASES="$APP_ROOT/releases"
BACKUPS="$DATA_DIR/backups"

if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "Deploy user does not exist: $DEPLOY_USER (pass DEPLOY_USER=<name>)" >&2
  exit 1
fi

echo "== Packages =="
pacman -S --needed --noconfirm git nodejs npm sqlite3 curl zram-generator sudo

node_major="$(node -p 'process.versions.node.split(".")[0]')"
echo "Node $(node -v) installed (expected major: $EXPECTED_NODE_MAJOR)"
if [ "$node_major" != "$EXPECTED_NODE_MAJOR" ]; then
  echo "Warning: Node major $node_major differs from the PC's $EXPECTED_NODE_MAJOR." >&2
  echo "Match the PC version before the first deploy, or install it explicitly." >&2
fi

echo "== Service account =="
if ! id -u lifelogger >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/bin/nologin lifelogger
  echo "Created lifelogger user"
else
  echo "lifelogger user already exists"
fi
usermod -aG lifelogger "$DEPLOY_USER"

echo "== Directories =="
install -d -o lifelogger -g lifelogger -m 0750 "$DATA_DIR" "$BACKUPS"
install -d -o "$DEPLOY_USER" -g lifelogger -m 0775 "$APP_ROOT" "$RELEASES"

echo "== Environment file =="
if [ ! -f "$ENV_FILE" ]; then
  api_key="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat >"$ENV_FILE" <<EOF
DB_PATH=$DATA_DIR/life.db
WEB_DIR=apps/web/dist
PORT=8080
HOST=0.0.0.0
LOG_LEVEL=info
API_KEY=$api_key
EOF
  chown root:lifelogger "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  echo "Created $ENV_FILE with a generated API key"
else
  echo "$ENV_FILE already exists; leaving it untouched"
fi

if [ ! -f "$APP_ROOT/version.env" ]; then
  printf 'APP_VERSION=unmanaged\n' >"$APP_ROOT/version.env"
  chown "$DEPLOY_USER":lifelogger "$APP_ROOT/version.env"
  chmod 0644 "$APP_ROOT/version.env"
fi

echo "== zram swap =="
ZRAM_CONF=/etc/systemd/zram-generator.conf
if [ ! -f "$ZRAM_CONF" ]; then
  cat >"$ZRAM_CONF" <<'EOF'
[zram0]
zram-size = ram / 2
compression-algorithm = zstd
EOF
  echo "Created $ZRAM_CONF (half of RAM as compressed swap)"
else
  echo "$ZRAM_CONF already exists; leaving it untouched"
fi
systemctl daemon-reload
if ! systemctl is-active --quiet systemd-zram-setup@zram0.service; then
  systemctl start systemd-zram-setup@zram0.service || true
fi

echo "== Lid and sleep =="
install -d -m 0755 /etc/systemd/logind.conf.d
cat >/etc/systemd/logind.conf.d/10-lifelogger-lid.conf <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
EOF
systemctl reload systemd-logind 2>/dev/null || true
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

echo "== systemd units =="
install -m 0644 "$SCRIPT_DIR/lifelogger.service" "/etc/systemd/system/$SERVICE_NAME.service"
install -m 0644 "$SCRIPT_DIR/lifelogger-backup.service" "/etc/systemd/system/$SERVICE_NAME-backup.service"
install -m 0644 "$SCRIPT_DIR/lifelogger-backup.timer" "/etc/systemd/system/$SERVICE_NAME-backup.timer"
systemctl daemon-reload

echo "== Deploy scripts =="
install -m 0755 "$SCRIPT_DIR/deploy.sh" "$APP_ROOT/deploy.sh"
install -m 0755 "$SCRIPT_DIR/backup.sh" "$APP_ROOT/backup.sh"
install -m 0755 "$SCRIPT_DIR/restore.sh" "$APP_ROOT/restore.sh"
chown "$DEPLOY_USER":lifelogger "$APP_ROOT/deploy.sh" "$APP_ROOT/backup.sh" "$APP_ROOT/restore.sh"

echo "== Git repository and hook =="
if [ ! -d "$REPO" ]; then
  git init --bare "$REPO"
  echo "Created bare repository at $REPO"
else
  echo "Bare repository already exists at $REPO"
fi
install -d -m 0755 "$REPO/hooks"
install -m 0755 "$SCRIPT_DIR/post-receive" "$REPO/hooks/post-receive"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$REPO"

echo "== Limited sudo for service control =="
SUDOERS=/etc/sudoers.d/lifelogger
cat >"$SUDOERS" <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $SERVICE_NAME, /usr/bin/systemctl start $SERVICE_NAME, /usr/bin/systemctl stop $SERVICE_NAME
EOF
chmod 0440 "$SUDOERS"
visudo -cf "$SUDOERS"

echo "== Enable services =="
systemctl enable "$SERVICE_NAME.service"
systemctl enable --now "$SERVICE_NAME-backup.timer"
if [ -e "$APP_ROOT/current" ]; then
  systemctl restart "$SERVICE_NAME.service"
fi

cat <<EOF

Provisioning complete.

Next steps:
  1. Add this server's SSH key for $DEPLOY_USER and disable password login.
  2. From the PC: git remote add server $DEPLOY_USER@<server>:$REPO
  3. From the PC: git push server main --tags
  4. Review $ENV_FILE and copy the API key to the Android app.
  5. Reboot once and confirm both units return without a login.
EOF
