# Running jarvis so sessions survive your laptop being closed

The jarvis server owns the tmux server that hosts every claude session. tmux
protects sessions from *jarvis* restarting — but nothing survives the machine
it runs on going to sleep. So for "laptop closed, sessions keep running, phone
can drive them", the server has to live on an always-on machine.

The web UI is already the terminal (xterm.js attached to tmux over a
WebSocket), so **no extra apps are needed on the phone**. The phone opens the
jarvis URL, installs it from the share menu ("Add to Home Screen" — it ships a
PWA manifest, so it launches fullscreen with its own icon), and gets the exact
claude CLI with a key bar for esc / tab / shift+tab / arrows. Closing the app
or turning the phone off only detaches the viewer; the session keeps running
in tmux on the server.

> **Why not the Claude mobile app?** The Claude app's coding sessions run in
> Anthropic's managed cloud sandbox against GitHub repos — it cannot attach to
> a self-hosted tmux session, your checkouts, or your machine. jarvis in the
> browser *is* the phone client for these sessions.

## Recommended: cloud VM + Tailscale

A basic DigitalOcean droplet (Ubuntu 24.04, 2 GB RAM, ~$12/mo) is plenty. No
VirtualBox involved — the droplet is the VM. Tailscale gives phone/laptop/
droplet a private network so nothing is exposed to the public internet.

### 1. Provision the droplet and run the setup script

```bash
# as root, once
adduser jarvis && usermod -aG sudo jarvis
su - jarvis

git clone <your-jarvis-remote> ~/jarvis
cd ~/jarvis && ./deploy/setup.sh
```

The script is idempotent and installs: Node 20, tmux, git, `build-essential`
(node-pty compiles from source on Linux), the Claude Code CLI, Tailscale,
jarvis's dependencies + production build, and a systemd unit
(`deploy/jarvis.service`) it enables immediately. The unit uses
`KillMode=process` — the default cgroup kill would take the detached tmux
server (and every claude session in it) down with jarvis.

Also clone the repos you want claude to work on — sessions run against
checkouts on the droplet, and `~/.claude.json` grows its known-repos list as
you use them.

### 2. One-time interactive logins

```bash
sudo tailscale up   # join your tailnet
claude              # run /login (finish the URL on your phone/laptop), then /exit
```

Install the Tailscale app on your phone and Mac and sign into the same
tailnet. The droplet gets a stable name like `jarvis-box.tail1234.ts.net`.

### 3. Publish to the tailnet over HTTPS

```bash
sudo tailscale serve --bg 3001
```

This proxies `https://jarvis-box.<tailnet>.ts.net` → `127.0.0.1:3001`,
reachable **only from your tailnet**, with a real TLS certificate (enable
HTTPS certificates once in the Tailscale admin console if prompted). jarvis
itself keeps listening on loopback — no firewall rules needed.

HTTPS matters beyond hygiene: browsers only expose the clipboard API in a
secure context, so copy-out of the terminal (tmux OSC 52 → browser clipboard)
silently fails over plain `http://`.

<details>
<summary>Alternative: bind 0.0.0.0 + firewall (no HTTPS)</summary>

Uncomment `Environment=HOST=0.0.0.0` in the unit, then either bind only the
Tailscale interface (`HOST=$(tailscale ip -4)`) or firewall the public one:

```bash
sudo ufw allow in on tailscale0 to any port 3001 proto tcp
sudo ufw deny 3001/tcp
sudo ufw enable
```

</details>

### 4. Phone

Open `https://jarvis-box.<tailnet>.ts.net` in the phone browser and use
Share → **Add to Home Screen**. It installs as a standalone app (fullscreen,
no browser chrome, home-screen icon). Sessions started from the phone, the
laptop, or SSH are all the same tmux sessions — attach from anywhere, close
anything, they keep running.

## Alternative: keep the Mac always awake

If you'd rather not run a server: leave the Mac plugged in with sleep disabled
(`sudo pmset -a sleep 0 displaysleep 5`, or Amphetamine), put Tailscale on the
Mac and phone, run `npm start` (with `tailscale serve --bg 3001`, or
`HOST=0.0.0.0`), and the phone reaches it the same way. The limitation is the
"laptop closed" case: a MacBook with the lid shut only stays awake in
clamshell mode (power + external display), so this is only reliable for a
desktop or a lid-open laptop.

## Notes

- Local dev is unchanged: `npm run dev` (vite on 5173 proxying to 3001).
- In production the Express server serves `web/dist` itself — one port total.
- The tmux server uses its own socket (`tmux -L jarvis ls` to inspect it
  manually); killing jarvis never kills sessions, `tmux -L jarvis kill-server`
  does.
- Redeploying after a `git pull`: `npm run build && sudo systemctl restart
  jarvis`. Restarting jarvis never touches running sessions.
