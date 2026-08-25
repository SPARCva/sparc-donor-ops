# SPARC Donor Operations

Internal dashboard for SPARC's development office. Shows what is waiting on a
decision — gifts missing a donor, sponsorships whose amount does not match their
level, tuition payments with no participant named — and lets staff resolve them,
push records to Bloomerang, and track thank-you letters.

Not public. Not for anyone outside SPARC staff.

## Running it locally

No build, no install. Serve the folder:

```bash
cd public
python3 -m http.server 8000
```

Then open `http://localhost:8000`. The backend accepts requests from any
origin, so localhost works against live data — which means **anything you
change locally changes the real records.** There is no staging environment.

## Deploying

Netlify project `sparc-donor-ops`, publishing from `public/`, no build command.
Pushing to `main` deploys to production. Branch pushes create previews.

The dashboard is reachable at three URLs, all served by this one deploy:

- `https://sparcsolutions.org/devdash` — how staff reach it. The `sparcwebsite`
  repo proxies `/devdash` and `/devdash/*` here in its `netlify.toml`; nothing
  is copied and there is no second deploy.
- `https://sparc-donor-ops.netlify.app/devdash/` — this project directly.
- `https://sparc-donor-ops.netlify.app/` — the catch-all serves the same page.

**Because of that first URL, the page is served from `public/devdash/` and its
asset references must be absolute and carry that base path** —
`href="/devdash/app.css"`, `url(/devdash/fonts/inter-latin.woff2)`.

The base path is not decoration. `sparcsolutions.org/devdash` has no trailing
slash, so a relative `app.css` resolves to `sparcsolutions.org/app.css` — the
marketing site's root — and the page loads unstyled. Adding a redirect to the
trailing-slash form does not help: Netlify matches `/devdash` and `/devdash/`
as the same path, so such a rule redirects to itself forever. Absolute
`/devdash/...` paths resolve correctly either way. If you add an image, font or
script, give it the `/devdash/` prefix too.

## Layout

```
public/devdash/index.html   markup
public/devdash/app.css      styles
public/devdash/app.js       the application
public/devdash/fonts/       self-hosted Archivo and Inter
netlify.toml         publish settings and security headers
CLAUDE.md            working instructions for Claude Code
docs/BACKEND.md      Edge Function endpoints, actions, editable columns
docs/TASKS.md        ordered backlog
```

## Accounts

Users live in the `app_users` table in Supabase, with bcrypt password hashes.
There is no self-service signup by design. To add someone, insert the row
server-side; they change their own password from the dashboard afterward.

## Contact

Erica Gaffney — erica@sparcsolutions.org
