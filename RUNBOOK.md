# RUNBOOK — jarvis: from local-only to always-on + phone

**Goal:** (1) claude sessions keep running when the MacBook lid closes, and
(2) they can be driven from a phone — where turning the phone off never kills
a session.

**How it's achieved:** jarvis moves to an always-on cloud VM (DigitalOcean
droplet). Sessions live in a tmux server there, so every client — phone,
laptop, SSH — is just a viewer that attaches and detaches. The phone client is
the jarvis web UI installed as a home-screen app (PWA). The **Claude mobile
app cannot be used for this**: its coding sessions run only in Anthropic's
cloud sandbox against GitHub repos and cannot attach to self-hosted sessions.

---

## Part 1 — Already done (no action needed)

Everything code-side is finished and the production build passes:

- **Core architecture** (previous work): each session is the real `claude`
  TUI in a dedicated tmux server (`tmux -L jarvis`), streamed to xterm.js in
  the browser over a WebSocket. Closing a browser/phone only detaches a
  viewer; restarting jarvis never touches sessions; dead sessions are
  auto-resumed with `claude --resume` on next attach.
- **Phone client (this round):**
  - PWA install support: `web/public/manifest.webmanifest`, app icons, and
    standalone-mode meta tags in `web/index.html`. "Add to Home Screen" gives
    a fullscreen app with its own icon, no browser chrome.
  - iOS keyboard fix: the layout now tracks `visualViewport`, so the terminal
    and key bar stay visible above the on-screen keyboard.
  - Safe-area padding so the key bar clears the iPhone home indicator.
- **Server deployment (this round):**
  - `deploy/setup.sh` — one-command, idempotent Ubuntu bootstrap (Node 20,
    tmux, build tools, Claude CLI, Tailscale, jarvis build, systemd service).
  - `deploy/jarvis.service` — systemd unit with `KillMode=process` so
    restarting jarvis can never take the tmux server (your sessions) down.
  - `DEPLOY.md` — rewritten around `tailscale serve` (tailnet-only HTTPS;
    HTTPS is required for copy-out of the terminal to reach the clipboard).

---

## Part 2 — What you need to do

Total: **~45 minutes** of setup, most of it waiting on installs.

| Thing | Where | Cost |
|---|---|---|
| DigitalOcean droplet (2 GB) | digitalocean.com | ~$12/mo |
| Tailscale (Personal plan) | tailscale.com | $0 |
| Claude subscription | — | already have |

> If you have a student email you may qualify for the **GitHub Student
> Developer Pack** (https://education.github.com/pack), which has historically
> included ~$200 of DigitalOcean credit — worth checking before paying.

### Step 0 — Commit and push the new work (2 min, on this Mac)

The droplet clones from GitHub, and the PWA/deploy work currently exists only
in the working tree. From `~/jarvis`:

```bash
git add -A
git commit -m "Add PWA support, iOS keyboard handling, and droplet deploy assets"
git push
```

(Or just ask me — I can commit and push it for you.)

Note: `github.com/jinmooxd/jarvis` is currently **public**. Nothing sensitive
is tracked (session data is gitignored), but if you'd rather make it private:
GitHub → repo → Settings → General → Danger Zone → Change visibility. If you
do, Step 4 additionally needs `gh auth login` on the droplet first.

### Step 1 — Tailscale account + apps on Mac and iPhone (10 min)

Tailscale puts your phone, Mac, and droplet on a private network so jarvis is
never exposed to the public internet.

1. Go to **https://login.tailscale.com/start** and sign up (sign in with
   Google/GitHub/Apple — pick one and stick with it on every device). The
   free **Personal** plan is enough.
2. **Mac:** install from https://tailscale.com/download (or the Mac App
   Store), open it, sign in with the same account, make sure the menu-bar
   toggle is **Connected**.
3. **iPhone:** App Store → search **Tailscale** → install → sign in with the
   same account → tap **Connect** and allow it to add a VPN configuration.
4. Verify: https://login.tailscale.com/admin/machines lists both devices.

### Step 2 — Create the DigitalOcean droplet (10 min)

1. Go to **https://www.digitalocean.com** → **Sign up** (email + credit
   card required).
2. First, put an SSH key on your Mac's clipboard (Terminal on the Mac):

   ```bash
   ssh-keygen -t ed25519          # press Enter through the prompts if you have no key yet
   pbcopy < ~/.ssh/id_ed25519.pub # copies the public key
   ```

3. In the DigitalOcean dashboard (**https://cloud.digitalocean.com**):
   **Create → Droplets**, then choose:
   - **Region:** closest to you (e.g. *New York* or *San Francisco*).
   - **OS image:** **Ubuntu 24.04 (LTS) x64**.
   - **Size:** *Basic* → *Regular* → **$12/mo — 2 GB RAM / 1 vCPU**.
     (Don't take the 1 GB one; compiling node-pty and running builds inside
     sessions will swap-thrash.)
   - **Authentication:** *SSH Key* → **New SSH Key** → paste the key from
     step 2 → name it `macbook`.
   - **Hostname:** `jarvis-box`.
4. Click **Create Droplet** and copy its **public IPv4 address** from the
   dashboard once it's up (~1 min).

### Step 3 — First login + create the `jarvis` user (5 min)

From the Mac terminal (replace `IP` with the droplet's address):

```bash
ssh root@IP
```

Then, on the droplet:

```bash
adduser jarvis                 # choose a password; Enter through the questions
usermod -aG sudo jarvis
rsync --archive --chown=jarvis:jarvis ~/.ssh /home/jarvis   # so `ssh jarvis@IP` works too
su - jarvis
```

(If SSH ever locks you out, the dashboard's **Access → Launch Droplet
Console** gives you a browser terminal.)

### Step 4 — Clone jarvis and run the setup script (10 min, mostly waiting)

Still on the droplet, as the `jarvis` user:

```bash
git clone https://github.com/jinmooxd/jarvis ~/jarvis
cd ~/jarvis && ./deploy/setup.sh
```

The script installs everything and starts jarvis as a systemd service.
Success looks like `Active: active (running)` in the status output at the
end. It finishes by printing the three interactive steps below.

### Step 5 — One-time logins on the droplet (5 min)

```bash
sudo tailscale up
```

It prints a URL — open it on your Mac or phone, approve, and `jarvis-box`
appears at https://login.tailscale.com/admin/machines with a name like
`jarvis-box.tailXXXX.ts.net`.

```bash
claude
```

Run `/login`, pick **Claude account with subscription**, open the printed URL
on your Mac/phone, paste the code back, then `/exit`. (Login state lives in
the droplet's home directory — every jarvis session uses it.)

### Step 6 — Publish over HTTPS to your tailnet (3 min)

1. In the Tailscale admin console → **DNS** tab
   (https://login.tailscale.com/admin/dns): make sure **MagicDNS** is on and
   click **Enable HTTPS** under HTTPS Certificates.
2. On the droplet:

   ```bash
   sudo tailscale serve --bg 3001
   tailscale serve status        # shows the https:// URL it now serves
   ```

Your permanent URL is now `https://jarvis-box.<tailnet>.ts.net` — reachable
only from devices on your tailnet, with a real TLS certificate. (HTTPS is
what makes copy-out of the terminal work; the clipboard API is blocked on
plain http.)

### Step 7 — Put your working repos on the droplet (5 min)

Sessions run against checkouts **on the droplet**, so clone what you work on:

```bash
sudo apt-get install -y gh
gh auth login    # GitHub.com → HTTPS → Login with a web browser → enter code on your Mac/phone
git clone https://github.com/you/your-repo ~/your-repo
```

The first time you start a session in a repo, use the **Other…** button in
the create dialog and enter its absolute path (e.g. `/home/jarvis/your-repo`)
— after that it appears in the dropdown automatically.

### Step 8 — Install on the phone (2 min)

1. Make sure the Tailscale app's toggle is **on**.
2. Open **Safari** (it must be Safari for this) →
   `https://jarvis-box.<tailnet>.ts.net`.
3. Tap **Share → Add to Home Screen → Add**.
4. Launch from the new home-screen icon: fullscreen jarvis, with the esc /
   tab / ⇧tab / ^C / arrow key bar above the keyboard.

### Step 9 — Verify the whole point (5 min)

- [ ] Create a session from the **phone**, give claude a long task.
- [ ] Force-quit the PWA, reopen → same session, still running.
- [ ] Open the same URL on the **Mac**, click the session → same live
      terminal from both devices at once.
- [ ] `ssh jarvis@jarvis-box` then `tmux -L jarvis ls` → your session is
      listed there; `sudo systemctl restart jarvis` → session unaffected.
- [ ] Close the MacBook lid, keep driving from the phone. ✅

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `setup.sh` fails building node-pty | `sudo apt-get install -y build-essential`, re-run the script |
| `posix_spawnp failed` when opening a terminal | node-pty's spawn-helper lost its exec bit: `npm install --prefix ~/jarvis/server` (postinstall chmod fixes it), `sudo systemctl restart jarvis` |
| `tailscale serve` complains HTTPS isn't enabled | Admin console → DNS → enable MagicDNS + HTTPS Certificates (Step 6.1) |
| Phone can't load the URL | Tailscale toggle off on the phone, or different tailnet account |
| Session shows **cold** after a droplet reboot | Expected — tmux dies on reboot. Click the session; jarvis resumes the conversation automatically (`claude --resume`) |
| Copy from the terminal doesn't reach the clipboard | You're on plain `http://` — use the `https://…ts.net` URL |
| Top bar says "Usage limits will appear…" forever | Known gap (the usage feed lost its producer in the SDK→CLI rewrite); harmless |

## Ongoing operations

- **Deploy an update:** on the droplet — `cd ~/jarvis && git pull && npm run
  build && sudo systemctl restart jarvis`. Running sessions are untouched.
- **Logs:** `journalctl -u jarvis -f`.
- **Nuke everything (including sessions):** `tmux -L jarvis kill-server` —
  the only command that actually kills sessions.
