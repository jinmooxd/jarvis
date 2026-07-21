# Running jarvis so sessions survive your laptop being closed

The jarvis server owns the tmux server that hosts every claude session. tmux
protects sessions from *jarvis* restarting — but nothing survives the machine
it runs on going to sleep. So for "laptop closed, sessions keep running, phone
can drive them", the server has to live on an always-on machine.

The web UI is already the terminal (xterm.js attached to tmux over a
WebSocket), so **no extra apps are needed on the phone** — no Termius, no VNC.
The phone opens the jarvis URL in the browser and gets the exact claude CLI,
with a key bar for esc / tab / shift+tab / arrows.

## Recommended: cloud VM + Tailscale

A basic DigitalOcean droplet (Ubuntu 24.04, 2 GB RAM, ~$12/mo) is plenty. No
VirtualBox involved — the droplet is the VM. Tailscale gives phone/laptop/
droplet a private network so nothing is exposed to the public internet.

### 1. Provision the droplet

```bash
# as root, once
adduser jarvis && usermod -aG sudo jarvis
su - jarvis

# node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs tmux git build-essential

# claude code + login (opens a URL — finish it on your phone/laptop, paste the code back)
sudo npm install -g @anthropic-ai/claude-code
claude   # run /login, then /exit
```

`build-essential` matters: on Linux, node-pty compiles from source at install
time.

### 2. Tailscale on all three devices

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Install the Tailscale app on your phone and Mac, sign into the same tailnet.
The droplet gets a stable name like `jarvis-box.tail1234.ts.net`.

### 3. Clone and run jarvis

```bash
git clone <your-jarvis-remote> ~/jarvis
cd ~/jarvis && npm install --prefix server && npm install --prefix web
npm run build
HOST=0.0.0.0 npm start
```

Also clone the repos you want claude to work on — sessions run against
checkouts on the droplet, and `~/.claude.json` grows its known-repos list as
you use them.

### 4. Lock the port to the tailnet

Either bind only to the Tailscale interface (`HOST=$(tailscale ip -4)`), or
firewall the public interface:

```bash
sudo ufw allow in on tailscale0 to any port 3001 proto tcp
sudo ufw deny 3001/tcp
sudo ufw enable
```

### 5. systemd unit

`/etc/systemd/system/jarvis.service`:

```ini
[Unit]
Description=jarvis claude session server
After=network-online.target

[Service]
User=jarvis
WorkingDirectory=/home/jarvis/jarvis
Environment=HOST=0.0.0.0
Environment=PORT=3001
ExecStart=/usr/bin/npm start
Restart=always
# Critical: default cgroup killing would take the detached tmux server (and
# every claude session in it) down with jarvis. Kill only the node process.
KillMode=process

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now jarvis
```

### 6. Phone

Open `http://jarvis-box.<tailnet>.ts.net:3001` in the browser and "Add to Home
Screen". Sessions started from the phone, the laptop, or SSH are all the same
tmux sessions — attach from anywhere, close anything, they keep running.

## Alternative: keep the Mac always awake

If you'd rather not run a server: leave the Mac plugged in with sleep disabled
(`sudo pmset -a sleep 0 displaysleep 5`, or Amphetamine), put Tailscale on the
Mac and phone, run `npm start` (or `npm run dev`) with `HOST=0.0.0.0`, and the
phone reaches it the same way. The limitation is the "laptop closed" case: a
MacBook with the lid shut only stays awake in clamshell mode (power + external
display), so this is only reliable for a desktop or a lid-open laptop.

## Notes

- Local dev is unchanged: `npm run dev` (vite on 5173 proxying to 3001).
- In production the Express server serves `web/dist` itself — one port total.
- The tmux server uses its own socket (`tmux -L jarvis ls` to inspect it
  manually); killing jarvis never kills sessions, `tmux -L jarvis kill-server`
  does.
