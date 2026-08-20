# Tasks

In order. Each is small enough to finish and verify in one sitting. Do not
batch them into a single pull request.

---

## 1. Land the first deploy

The Netlify project `sparc-donor-ops` exists but has never received a
successful deploy, so `sparc-donor-ops.netlify.app` currently serves nothing.

- Connect this repo to the existing Netlify project. Do **not** create a new
  site — the id is in `CLAUDE.md`.
- Confirm `publish = "public"` and an empty build command are picked up.
- Deploy, then verify in a browser: the sign-in card renders, Archivo and Inter
  load, and a wrong password returns "Incorrect email or password." rather than
  a CORS or network error.
- Verify the security headers actually landed (`curl -I` the deploy URL).

**Done when:** Erica can sign in at the Netlify URL and see the dashboard.

---

## 2. Keep the session across a refresh

Right now `TOKEN` lives in a module-scope variable, so every page refresh
signs the user out mid-task. The backend already returns `expires_at`.

- Persist the token and its expiry in `sessionStorage`.
- On load, if a stored token is present and unexpired, call `me` and go
  straight to the app view; if `me` returns 401, clear it and show sign-in.
- `logout` clears the stored value.
- Do not use `localStorage` — this is donor data on a shared office machine,
  and the session should die with the tab.

---

## 3. Handle a backend that is down

`refresh()` currently drops a red error box into whichever tab is open and
leaves the other three panels stuck on "Loading…".

- Show one clear failure state across all panels.
- Add a retry button rather than making the user reload.
- Distinguish "not signed in" (401 → return to sign-in) from "server
  unreachable" (network error → offer retry).

---

## 4. Custom domain

Point `ops.sparcsolutions.org` at the Netlify project. The apex domain
`sparcsolutions.org` is already served by the `sparcwebsite` project on the
same Netlify team, so this is a subdomain record, not a domain transfer. Do not
touch the apex configuration.

---

## 5. Second lock on the front door

The app's own login is real, but the page is publicly addressable. Check
whether the team plan (`nf_team_dev`) includes site password protection or SSO
team login. If it does, turn one on. If it does not, write up what a plan
upgrade would cost and hand that to Erica rather than deciding it.

---

## 6. Tighten the CSP

`script-src` and `style-src` currently need `'unsafe-inline'` because the CSS
and JS live inside `index.html`.

- Extract the style block to `public/app.css` and the script block to
  `public/app.js`.
- Drop `'unsafe-inline'` from both directives in `netlify.toml`.
- Self-host the two font families under `public/fonts/` and drop the Google
  Fonts entries from `style-src` and `font-src` entirely.

Keep it three plain files. Still no bundler.

---

## 7. Mobile pass

There is one breakpoint at 620px and the record tables scroll horizontally at
620px minimum width. Erica reviews flags on a phone between centre visits.
Check the "Needs an answer" cards and the note composer specifically — the
`.controls` row wraps badly on narrow screens.

---

## 8. Only if asked

Do not start these without a conversation first:

- Splitting the dashboard into routed views
- Any framework
- A shared component library
- Server-side rendering
- Realtime subscriptions
