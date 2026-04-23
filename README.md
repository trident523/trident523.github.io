# Status page

A single page for medical-journey updates. Posts can be text, photos, or audio.
Visitors can leave a public note. The author can post updates from anywhere —
the web, an SMS, or a phone call that leaves a voicemail.

- **Site**: Astro, deployed to GitHub Pages (free).
- **Inbox API**: one Cloudflare Worker (free tier).
- **Phone/SMS**: Twilio — two numbers (admin + public).
- **Spam protection**: Cloudflare Turnstile on the web form; PIN on admin paths; KV-backed lockout on repeated bad PINs.

Published at **https://trident523.github.io/miniature-enigma/**
(if you later rename the repo to `trident523.github.io`, change `base` in
`astro.config.mjs` to `"/"` to serve from the root domain.)

---

## Architecture

```
       visitor                         you
         │                              │
  ┌──────┼──────┐              ┌────────┼────────┐
  │ web form    │              │ web admin (PIN) │
  │ SMS/call →  │              │ SMS/call →      │
  │ PUBLIC_NUM  │              │ ADMIN_NUM + PIN │
  └──────┬──────┘              └────────┬────────┘
         └───────────┐       ┌──────────┘
                     ▼       ▼
            ┌────────────────────────┐
            │ Cloudflare Worker      │
            │  /messages             │
            │  /admin/post           │
            │  /twilio/sms           │
            │  /twilio/voice (TwiML) │
            └──────────┬─────────────┘
                       │ GitHub Contents API
                       ▼
            ┌────────────────────────┐
            │ repo (this one)        │
            │  src/content/posts/    │
            │  src/content/messages/ │
            │  public/media/...      │
            └──────────┬─────────────┘
                       │ push → Action builds
                       ▼
                GitHub Pages
```

Each post or incoming note is a JSON file in `src/content/posts/` or
`src/content/messages/`. Images and voicemails are committed under
`public/media/`. A push triggers the deploy workflow, which rebuilds Astro
and publishes to Pages.

---

## One-time setup

### 1. Local dev (optional)

```bash
npm install
npm run dev            # site at http://localhost:4321/miniature-enigma
cd worker && npm install
npx wrangler dev       # worker at http://localhost:8787
```

### 2. GitHub Pages

- Repo **Settings → Pages → Source: GitHub Actions**.
- Under **Settings → Actions → Variables**, add two repo variables (after
  you've deployed the Worker and created Turnstile):
  - `PUBLIC_WORKER_URL` — e.g. `https://miniature-enigma.<your-subdomain>.workers.dev`
  - `PUBLIC_TURNSTILE_SITE_KEY` — the Turnstile **site** key (public)

### 3. Cloudflare Turnstile

- [dash.cloudflare.com → Turnstile → Add site](https://dash.cloudflare.com/?to=/:account/turnstile).
- Domain: `trident523.github.io`. Widget mode: managed.
- Save the **site key** (public, for the form) and the **secret key** (for the Worker).

### 4. Twilio

1. Create a Twilio account and buy **two phone numbers**.
2. For each number, set the webhooks under **Phone Numbers → Manage → Active numbers**:
   - **A call comes in** → HTTP POST → `https://<worker-url>/twilio/voice`
   - **A message comes in** → HTTP POST → `https://<worker-url>/twilio/sms`
3. Note the numbers in E.164 (`+15551234567`) — one is admin, one is public.
4. Copy your **Account SID** and **Auth Token** from the Twilio console
   (needed as Worker secrets to download voicemails and MMS media).

### 5. GitHub token for the Worker

Create a **fine-grained personal access token** limited to this repo:

- Repository access: only `trident523/miniature-enigma`.
- Permissions: **Contents: Read and write**, **Metadata: Read** (required).
- Save the token — you'll give it to the Worker as `GITHUB_TOKEN`.

### 6. PIN hash

Pick a numeric PIN you can remember (4–12 digits). Compute its SHA-256 hex:

```bash
printf %s '123456' | shasum -a 256 | awk '{print $1}'
```

Give that hash (not the PIN) to the Worker as `PIN_HASH`. If you forget the
PIN, rotate it by recomputing and running `wrangler secret put PIN_HASH`.

### 7. Deploy the Worker

```bash
cd worker

# One-time: create a KV namespace for rate-limiting and paste the id into wrangler.toml
npx wrangler kv namespace create RATE_LIMIT
# Edit wrangler.toml: set ADMIN_NUMBER, PUBLIC_NUMBER, and the KV id

# Set secrets
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put PIN_HASH
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN

npx wrangler deploy
```

The first deploy prints your Worker URL. Set `PUBLIC_WORKER_URL` as a repo
variable (step 2) and point Twilio's webhooks at it (step 4).

### 8. Publish

Push any change to `main`. The Action builds and publishes to Pages.

---

## How posting works

**From the web** (`/admin`): type the PIN, write the update, optionally attach
an image or audio file. Submits to the Worker, which commits a new JSON entry
(and the media file) to the repo. A build kicks off automatically.

**By SMS to the admin number**: send a text of the form

```
123456 today's update in the rest of the message
```

The first whitespace token is the PIN. MMS attachments (photos, voice memos)
are accepted and committed as media. Anything sent to the **public** number
skips the PIN and becomes a visitor note instead.

**By phone to the admin number**: you're prompted for PIN + `#`, then
recording. Press `#` to stop; it's posted as an audio update.

**By phone to the public number**: caller hears a short greeting, then a beep,
and the recording becomes a visitor note.

## How visitors post notes

Either use the form on the homepage (Turnstile checks for spam) or send an SMS
or leave a voicemail at the public number. All three paths land in
`src/content/messages/` and appear on the homepage in reverse-chronological
order, interleaved with your updates.

## Cost sketch (approximate, USD)

- GitHub Pages — free.
- Cloudflare Worker + Turnstile + KV — free tier is plenty.
- Twilio — ~$1/month per phone number, plus per-message / per-minute fees
  (SMS ~ $0.008, voice ~ $0.014/min inbound, recording ~ $0.0025/min storage).
  With light traffic, expect **a few dollars a month** total.

## Deleting something

Every entry is a file. Delete the JSON (and any referenced media in
`public/media/`) and push; the next build drops it from the page. No database,
no admin console.
