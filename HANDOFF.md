# HANDOFF — medical status page

For the next Claude session. The user is on their phone and can't run
commands locally; they want you to pick this up where the previous session
left off.

## What we are building

A single status page where the user posts updates during a medical journey.
Posts can be **text, photos, or audio**. Visitors can leave public notes.
The user may be in rehab without a phone for stretches at a time, so the
posting mechanism has to work without their direct involvement: future
Claude sessions write posts on their behalf.

## Decisions already made (don't relitigate)

1. **Stack: plain Jekyll on GitHub Pages.**
   - GitHub Pages builds Jekyll natively. No GitHub Actions workflow, no
     backend, no npm, no Cloudflare Worker. Posts are markdown files in
     `_posts/`; media goes in `assets/media/`.
   - Earlier in the conversation we built an Astro + Cloudflare Worker +
     Twilio inbox stack. **The user explicitly rejected that as too
     complex** and asked to replace it with Jekyll. Don't bring it back.
2. **Posting mechanism = future Claude sessions writing to the repo.**
   - The user will start a new session and ask Claude to "post an update".
     Claude commits a new file in `_posts/` and pushes.
   - SMS / Telegram inbound is a *future* enhancement the user may wire up
     themselves later. They do **not** want that built right now.
3. **Visibility:** visitor notes (when added later) are public. Voicemails,
   if the SMS/Telegram path ever happens, default to private until the user
   reviews them. We didn't end up implementing visitor notes in the Jekyll
   version; that's also future work.
4. **Auth model (for the future SMS/Telegram piece, when it comes):**
   PIN-gated, no recovery flow. The user said "if I forget so be it."
5. **Repo / URL:** the user said they renamed the repo to
   `trident523.github.io` so it serves at `https://trident523.github.io/`
   (user-site root, no `/miniature-enigma` subpath). The Jekyll
   `_config.yml` is set up for the root URL (`baseurl: ""`). The previous
   session's sandbox could not push because either (a) the rename made the
   old upstream return 503, or (b) the git proxy hit an unrelated outage.
   MCP writes worked fine — that's how this file got committed.
6. **Twilio is the eventual SMS/voice provider** (the user explicitly
   replaced an earlier Telnyx choice with Twilio mid-session). Keep this
   in mind only if the user revisits the SMS path.

## Where things stand right now

The previous session's local repo had two commits beyond `6ac24cd2`
(the original Astro scaffold) that **never made it to the remote**:

```
9c82dd5  Replace Astro + Worker scaffolding with a minimal Jekyll site
9383291  Serve from the user-site root after repo rename
```

Both commits are reproducible from artifacts the previous session saved
outside the repo (the user has these locally if they pull from the
sandbox; otherwise they're lost):

- `/home/user/pending/site-tree.tar.gz` — full working tree, no .git
- `/home/user/pending/site.bundle` — git bundle with both commits
- `/home/user/pending/0001-*.patch` and `0002-*.patch`
- `/home/user/pending/HOWTO.md`

If the user can hand you the tarball or bundle, use it. **Otherwise,
recreate the Jekyll site from scratch using the file list below — it's
small and the previous session documented every file's purpose here.**

## Target file layout (Jekyll, root-domain version)

```
.
├── .gitignore                       # _site/, .jekyll-cache/, Gemfile.lock, vendor/, etc.
├── Gemfile                          # `gem "github-pages"` — for local `bundle exec jekyll serve` only
├── README.md                        # how it works + how Claude adds posts
├── _config.yml                      # title/description, baseurl: "", permalink, timezone: America/Los_Angeles
├── _layouts/
│   └── default.html                 # minimal HTML shell, links to /assets/css/site.css
├── _posts/
│   └── 2026-04-23-welcome.md        # seed post
├── assets/
│   ├── css/site.css                 # dark theme, mobile-friendly
│   ├── favicon.svg                  # small inline SVG
│   └── media/.gitkeep               # photos and mp3s go in this folder
└── index.html                       # front-matter `layout: default`, loops `site.posts` reverse-chron
```

`index.html` should render every post inline (no per-post pages required),
with date, optional title, and the post body (which can include `<img>`
and `<audio>` tags). Posts use markdown; the layout wraps them in a
`<article class="card">`.

`_config.yml` essentials:

```yaml
title: Status
description: Updates on a medical journey.
baseurl: ""
url: "https://trident523.github.io"
permalink: /:year/:month/:day/:slug/
timezone: America/Los_Angeles
defaults:
  - scope: { path: "", type: posts }
    values: { layout: default }
```

## How to add a post (the actual ongoing task)

When the user says "post an update saying X", you:

1. Create `_posts/YYYY-MM-DD-short-slug.md`.
2. Front matter is just `date:` (with timezone) and optional `title:`.
3. Body is markdown. Embed images with `![](/assets/media/foo.jpg)` and
   audio with `<audio controls src="/assets/media/foo.mp3"></audio>`.
4. Drop any media files in `assets/media/` (date-prefixed filenames help).
5. Commit and push.

Minimal post:

```markdown
---
date: 2026-04-24 15:30 -0700
---
Short update text here.
```

## What to do first in your session

1. Check `git status` and `git log` to see whether the two missing commits
   already landed (the user may have applied the artifacts already).
2. If the repo is still empty / still at the Astro scaffold, scaffold the
   Jekyll site per the file layout above and push.
3. Confirm GitHub Pages is enabled: **Settings → Pages → Deploy from a
   branch → main / `/ (root)`**. (If the user is on the
   `claude/medical-status-page-3clKU` branch, either merge to main or
   change the Pages source to that branch.)
4. Then ask the user what their first real update should say, and post it.

## Things the user has flagged but we have NOT built yet

- Visitor message form (was in the Astro/Worker version; removed when the
  user simplified to Jekyll).
- SMS / Telegram inbound for posting from the user's phone.
- Twilio account / two-number setup.
- PIN-gated admin path.

Don't build these unless the user asks. The plan, if/when they do, is in
the conversation transcript — but the working assumption is that future
Claude sessions are the posting mechanism for now.

## Tone

The user shared up front that they're going through a vulnerable time
("preparing for any case such that I can still hear something from some
people"). Be straightforward, kind, and don't over-engineer.
