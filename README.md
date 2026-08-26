# SPARC Development Dashboard

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

The dashboard itself is served at two URLs by this one deploy:

- `https://sparc-donor-ops.netlify.app/devdash/` — the canonical address, and
  where staff end up.
- `https://sparc-donor-ops.netlify.app/` — the catch-all serves the same page.

Staff start at `https://sparcsolutions.org/devdash`, which is **not** a proxy
of this deploy. That domain is served by GitHub Pages from the `sparcwebsite`
repo, and Pages cannot proxy — `/devdash` there is a real file,
`devdash/index.html`, that forwards here. The address bar changes after the
hop. Do not "restore" a `status = 200` proxy rule for it: that has been tried
twice and both times the path 404'd for staff while still working on
`*.netlify.app`, which is where it gets tested. See `CLAUDE.md` for the
one-command check, and `.github/workflows/devdash-guard.yml` in `sparcwebsite`
for the guard that now enforces it.

**The page is served from `public/devdash/`, so its asset references must be
absolute and carry that base path** — `href="/devdash/app.css"`,
`url(/devdash/fonts/inter-latin.woff2)`.

The base path is not decoration. The catch-all in `netlify.toml` sends any
unmatched path to `/devdash/index.html`, so a relative `app.css` requested
from a URL without a trailing slash resolves to the project root and comes
back as that HTML page with the wrong content type — and the dashboard loads
unstyled. Absolute `/devdash/...` paths resolve correctly from every URL that
serves the page. If you add an image, font or script, give it the `/devdash/`
prefix too.

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
