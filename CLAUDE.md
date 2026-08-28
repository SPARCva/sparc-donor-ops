# CLAUDE.md — SPARC Development Dashboard

Instructions for Claude Code working in this repo. Read this before changing anything.

## FIRST, every session: read CLAUDE-OPS.md in Drive

Erica keeps the live operating instructions in her Drive "Claude" folder:
**`CLAUDE-OPS.md`**, file id `13upNtY2jL_jPLpRIPoCIkTwPO-bf328A`, in folder
`1WXGClLRm0OWY--qL9XrFxChN8vAgJIWg`. Fetch it through the Google Drive
connector at the start of any session that touches this application — the
dashboard, the Supabase backend, Gmail/Drive automation, or Bloomerang — and
follow it. It is updated more often than this file; where the two disagree,
CLAUDE-OPS.md is newer and wins. Also read the `ops_memory` table it points
to (`status='saved'` rows are standing directives from Erica and Debi). If
the Drive connector is unavailable, say so to Erica before changing anything.

## What this is

An internal admin dashboard for SPARC's development office. It surfaces gifts,
sponsorships, RSVPs and tuition payments that a nightly email sweep pulled in,
flags the ones that are missing a donor, an amount or a designation, and lets
staff resolve them, push records to Bloomerang, and track thank-you letters.

One person uses it: Erica Gaffney, Director of Development & Communications.
It is not public-facing.

## Architecture

- **Frontend:** three static files under `public/devdash/` — `index.html`,
  `app.css`, `app.js`. Vanilla JS, no framework, no build step, no bundler, no
  npm dependencies. Fonts are self-hosted `.woff2` in `public/devdash/fonts/`;
  there is no Google Fonts request, and the CSP has no off-domain font host.
- **Backend:** Supabase Edge Functions, project ref `ldxpockcgcxvsrbyhcnt`.
  Deployed and live — see `docs/BACKEND.md`. **This repo does not contain the
  backend.** Do not change an Edge Function or the schema without Erica asking
  for it in so many words: there is no staging database, so every migration and
  every deploy lands on live donor data. When she does ask, read the deployed
  source first (it is the only copy) and write the change up in
  `docs/BACKEND.md` in the same pass.
- **Hosting:** Netlify project `sparc-donor-ops`
  (site id `3afeba34-e865-4e35-a30e-27a59dce6b30`, team id
  `6980b8c5cb88ed7684233e75`). Deployed and live since 21 Aug 2026 at
  https://sparc-donor-ops.netlify.app/devdash/. Staff start at
  https://sparcsolutions.org/devdash, which forwards here — that path is a
  file on GitHub Pages, not a proxy. See "How staff reach it" below before
  changing anything about it.

Frontend talks to the backend over `POST` with a JSON `{ action, ...body }`
envelope and a `Bearer` token in the `Authorization` header. Both endpoints are
already declared at the top of `public/devdash/app.js`.

## Hard rules

1. **No secrets in this repo, ever.** No API keys, no service role keys, no
   passwords, no `.env` committed. The two Supabase function URLs in
   `index.html` are public endpoints protected by the app's own bcrypt login;
   they are safe to commit. Nothing else is.
2. **Do not weaken auth.** Sessions are server-side, tokens are hashed with
   SHA-256 before storage, and passwords are bcrypt. Do not move auth into the
   client, do not add a "remember me" that stores a raw password, do not
   disable the 8-hour session expiry.
3. **Do not add a build step or a framework** without being asked. The whole
   point of three plain files is that Erica can open them, read them, and hand
   them to someone else. If a change seems to require React, propose it first.
4. **Do not silently overwrite staff work.** The backend enforces this
   (`logo_locked` on sponsorships, `question_dismissals`). Any UI change must
   respect it — never build a bulk action that blows past a lock.
5. **Donor PII is on every screen.** No analytics, no third-party scripts, no
   error-reporting service that ships payloads off-domain. Keep `connect-src`
   in `netlify.toml` pinned to the Supabase project.
6. **Never invent data.** If a field is missing, the UI shows it as missing and
   asks. That is the entire product. Do not add defaults, placeholders, or
   inferred values that look like real records.

## Conventions in `public/devdash/`

- Colours are CSS custom properties on `:root` (`--ink`, `--paper`, `--green`,
  `--blue`, `--amber`, `--red` and their `-soft` pairs). Use them; do not
  hardcode hex values in new rules.
- Type: Archivo for headings and numerals, Inter for body. `letter-spacing:-.02em`
  on headings.
- All user-supplied strings go through `esc()` before reaching `innerHTML`.
  Every single one. No exceptions.
- Money through `money()`, dates through `day()`, elapsed days through
  `daysSince()`.
- Panels render by replacing `innerHTML` wholesale from a `render*()` function,
  then a single delegated `click` listener at the bottom handles actions via
  `data-*` attributes. Follow that pattern rather than attaching listeners to
  individual nodes.
- Copy is plain and calm: "Nothing is waiting on you", "Fill in a value first".
  No exclamation marks, no "Oops", no product-speak.

## Deploying

Netlify builds from `main`. `publish = "public"`, no build command. A push to
`main` is a production deploy. Preview deploys on branches.

### How staff reach it

`https://sparcsolutions.org/devdash` is **not** a proxy of this deploy, and
must not be turned into one. That domain is served by **GitHub Pages** from
the `sparcwebsite` repo, and Pages cannot proxy anything — no rewrites, no
`netlify.toml`. Check it in one command:

```
curl -sI https://sparcsolutions.org | grep server   # GitHub.com
curl -s  https://sparcsolutions.org/netlify.toml    # 200 — the file itself
```

`sparcsolutions.org/devdash` is a real file, `devdash/index.html` in
`sparcwebsite`, which forwards staff here. So the address bar changes after
the hop and staff land on `sparc-donor-ops.netlify.app/devdash/`. That
forwarding page is protected by `.github/workflows/devdash-guard.yml` in that
repo; a `status = 200` proxy rule has been restored there twice and both
times `/devdash` 404'd for staff while still working on `*.netlify.app`,
which is where it gets tested. The DNS is not being repointed — treat that as
settled and do not propose it.

**The `/devdash/` base path is still required**, for a different reason than
the docs used to give. This project's own deploy serves the app at
`/devdash/`, so **every asset reference must be absolute and start with
`/devdash/`** — `href="/devdash/app.css"`,
`url(/devdash/fonts/inter-latin.woff2)`.

Do not "flatten" this back to the project root or switch to relative paths.
The catch-all in `netlify.toml` sends any unmatched path to
`/devdash/index.html`, so a relative `app.css` requested from a URL without a
trailing slash resolves to the project root and comes back as HTML with the
wrong content type — the page then loads unstyled. Absolute `/devdash/…`
paths resolve correctly from every URL that serves the page. The
`/accessibility` app is built with a base path for the same reason.

Before pushing anything to `main`, confirm the change with Erica — this is a
live tool she relies on daily, and there is no staging data.

## Where to start

`docs/TASKS.md`, in order. Task 1 (first deploy) landed on 21 Aug 2026.
