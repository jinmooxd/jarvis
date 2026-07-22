#!/usr/bin/env bash
# Bootstrap an Ubuntu box (e.g. a DigitalOcean droplet) to run jarvis as a
# service. Idempotent — safe to re-run. Run from the repo root as a
# sudo-capable non-root user:
#
#   ./deploy/setup.sh
#
# Interactive steps it can NOT do for you (it prints reminders at the end):
#   sudo tailscale up            # join your tailnet
#   claude                       # run /login once, then /exit
#   sudo tailscale serve --bg 3001   # publish over HTTPS, tailnet-only
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="$(whoami)"

if [ "$RUN_USER" = "root" ]; then
  echo "Run as a normal sudo-capable user (the service will run as that user), not root." >&2
  exit 1
fi

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "System packages (tmux, git, build-essential for node-pty)"
sudo apt-get update -qq
sudo apt-get install -y -qq tmux git build-essential curl

if ! command -v node >/dev/null || [ "$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')" -lt 20 ]; then
  step "Node.js 20 (nodesource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
else
  step "Node.js $(node --version) already present"
fi

if ! command -v claude >/dev/null; then
  step "Claude Code CLI"
  sudo npm install -g @anthropic-ai/claude-code
else
  step "Claude Code CLI already present ($(command -v claude))"
fi

if ! command -v tailscale >/dev/null; then
  step "Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
else
  step "Tailscale already present"
fi

step "jarvis dependencies + build"
npm install --prefix "$REPO_DIR/server"
npm install --prefix "$REPO_DIR/web"
(cd "$REPO_DIR" && npm run build)

step "systemd unit"
NODE_BIN="$(command -v node)"
sed -e "s|__USER__|$RUN_USER|g" \
    -e "s|__DIR__|$REPO_DIR|g" \
    -e "s|__NODE__|$NODE_BIN|g" \
    "$REPO_DIR/deploy/jarvis.service" | sudo tee /etc/systemd/system/jarvis.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now jarvis
sleep 1
sudo systemctl --no-pager --lines=5 status jarvis || true

cat <<'EOF'

Done. Remaining one-time interactive steps:

  1. sudo tailscale up                 # join your tailnet (also on phone + laptop)
  2. claude                            # run /login, then /exit
  3. sudo tailscale serve --bg 3001    # https://<machine>.<tailnet>.ts.net -> jarvis
                                       # (enable HTTPS certs once in the Tailscale
                                       #  admin console if it asks)

Then open the https URL on your phone and use Share -> Add to Home Screen.
EOF
