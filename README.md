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

The dashboard is reachable at two URLs, both served by this one deploy:

- `https://sparc-donor-ops.netlify.app/` — the Netlify project directly.
- `https://sparcsolutions.org/devdash/` — the same files, proxied through the
  main website. The `sparcwebsite` repo rewrites `/devdash/*` here in its
  `netlify.toml`; nothing is copied and there is no second deploy.

**Because of that second URL, every asset reference in `public/` must stay
relative** — `href="app.css"`, `url(fonts/inter-latin.woff2)`, never a leading
slash. A root-relative path resolves against `sparcsolutions.org/` under the
proxy and loads the wrong file (or nothing). If you add an image, font or
script, reference it relative to the file that points at it.

## Layout

```
public/index.html    the entire application
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
