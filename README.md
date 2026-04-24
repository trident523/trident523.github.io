# Status

A tiny Jekyll site for posting updates during a medical journey. Built on
GitHub Pages' native Jekyll support — no build server, no Actions, no backend.
Posts are markdown files in `_posts/`. Media (photos, audio) sit in
`assets/media/`. Pushing to the default branch publishes the site.

Lives at **https://trident523.github.io/** (this repo is named
`trident523.github.io`, which GitHub Pages serves from the user-site root).

## How to publish

1. On GitHub, go to **Settings → Pages → Source: Deploy from a branch**,
   pick the branch you want (typically `main`), folder `/ (root)`, and save.
2. Push any commit. Pages rebuilds within a minute.

## How Claude adds a post

Ask Claude (in a future session) to "post an update" with whatever content.
Claude will:

1. Create a file under `_posts/` named `YYYY-MM-DD-short-slug.md`.
2. Add front matter with the `date:` (and optional `title:`).
3. Write the body in markdown. Embed images/audio with standard markdown or
   HTML (see below).
4. Commit and push.

A minimal post:

```markdown
---
date: 2026-04-24 15:30 -0700
---
Short update text here.
```

A post with a photo:

```markdown
---
date: 2026-04-24 15:30 -0700
title: After the appointment
---
Feeling better today.

![](/assets/media/2026-04-24-garden.jpg)
```

A post with audio:

```markdown
---
date: 2026-04-24 15:30 -0700
---
Left a voice note.

<audio controls src="/assets/media/2026-04-24-note.mp3"></audio>
```

> Asset paths are relative to the site root (`baseurl` is empty in
> `_config.yml`). Or use Jekyll's `{% raw %}{{ '/assets/...' | relative_url }}{% endraw %}` helper.

## Media

Drop files in `assets/media/`. A date-prefixed filename keeps things ordered:

```
assets/media/2026-04-24-garden.jpg
assets/media/2026-04-24-note.mp3
```

No size enforcement here — but GitHub recommends files under 50 MB and hard-
caps at 100 MB. For long voice notes, prefer MP3 or AAC (`.m4a`) over WAV.

## Hooking up SMS / Telegram later

For now, Claude sessions are the write path. When you're ready, point a bot
(Telegram, or a Twilio/ClickSend SMS webhook) at a serverless endpoint that
commits a new file to `_posts/` via the GitHub Contents API — same shape as
what Claude writes. This repo won't need any changes to receive those.

## Deleting a post

Delete the file in `_posts/` (and any referenced asset in `assets/media/`)
and push. No database, no admin console.

## Local preview (optional)

```bash
bundle install
bundle exec jekyll serve
# http://127.0.0.1:4000/
```
