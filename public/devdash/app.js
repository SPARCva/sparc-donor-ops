const OPS = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/donor-ops";
const BLM = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/bloomerang";
const TSK = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/tasks";
const ASK = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/asks";
const DOC = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/docs";
const LTR = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/letters";
let TOKEN = null, USER = null, D = null, TAB = "bloomerang";
// Today and Completed load from their own endpoint, so they keep their own
// state rather than hanging off the donor-ops dashboard payload.
// T still holds the task list even though Today is gone as a tab: Asks builds
// its "not drafted yet" list from it, and Follow ups its candidates. L is the
// letters payload.
let T = null, C = null, CFROM = null, CTO = null, A = null, F = null, DOCS = null, L = null;
// The full revision for a document, keyed by its id. `docs.list` sends only the
// applied/not-applied COUNTS to keep a six-document listing small, so the arrays
// and the text are held here from the `revise` call that returned them.
const REV = {};

// Session lives in sessionStorage, never localStorage: this is donor data on a
// shared office machine, so the session must die with the tab. We keep the
// token, its server-issued expiry and the user record so a refresh can go
// straight back to the app instead of the sign-in card.
const SESSION_KEY = "sparc_donor_ops_session";
function saveSession(r) {
  TOKEN = r.token; USER = r.user;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: r.token, expires_at: r.expires_at, user: r.user })); } catch {}
}
function clearSession() {
  TOKEN = null; USER = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}
function readSession() {
  let s; try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  if (!s || !s.token) return null;
  if (s.expires_at && new Date(s.expires_at).getTime() <= Date.now()) return null;
  return s;
}

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

async function call(url, action, body = {}) {
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type":"application/json", ...(TOKEN ? { Authorization:`Bearer ${TOKEN}` } : {}) },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    // fetch rejects only when the request never reached the server.
    const err = new Error("Can't reach the server. Check your connection and try again.");
    err.offline = true;
    throw err;
  }
  const out = await r.json().catch(() => ({ error:"The server sent something unreadable." }));
  if (!r.ok) { const err = new Error(out.error || `Request failed (${r.status}).`); err.status = r.status; throw err; }
  return out;
}
const api = (a, b) => call(OPS, a, b);
const blm = (a, b) => call(BLM, a, b);
const tsk = (a, b) => call(TSK, a, b);
const ask = (a, b) => call(ASK, a, b);
const doc = (a, b) => call(DOC, a, b);

const money = n => n == null ? "—" : "$" + Number(n).toLocaleString("en-US",
  { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
// A bare YYYY-MM-DD is a calendar date, but `new Date("2026-08-21")` parses it
// as midnight UTC — which renders as the 20th anywhere west of Greenwich,
// including here. donation_date, sponsorship_date, payment_date, due_at,
// completed_on and the `today` the tasks endpoint returns all arrive this way,
// so they are built in local time instead. Values that carry a time are already
// unambiguous and are left alone.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function asDate(d) {
  if (d == null || d === "") return null;
  if (d instanceof Date) return isNaN(d) ? null : d;
  const s = String(d);
  if (DATE_ONLY.test(s)) { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); }
  const t = new Date(s);
  return isNaN(t) ? null : t;
}
const day = d => { const t = asDate(d); return t ? t.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : "—"; };
// Whole calendar days, not elapsed 24-hour periods: "3 days" on a card means
// three days on the calendar, which is how the 7, 21 and 45 day thresholds in
// waitBlock() are read. Rounding rather than flooring keeps a clock change from
// costing or adding a day.
function daysSince(d) {
  const t = asDate(d); if (!t) return null;
  const then = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - then) / 86400000));
}

function waitBlock(days) {
  if (days == null) return `<div class="wait w-cool"><b>—</b><span>no date</span></div>`;
  const h = days >= 45 ? "w-cold" : days >= 21 ? "w-hot" : days >= 7 ? "w-warm" : "w-cool";
  return `<div class="wait ${h}"><b>${days}</b><span>${days === 1 ? "day" : "days"}</span></div>`;
}

// ---------------------------------------------------------------- sign in
$("signinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const b = $("signinBtn"); b.disabled = true; b.textContent = "Signing in…"; $("signinMsg").innerHTML = "";
  let signedIn = false;
  try {
    const r = await api("login", { email:$("email").value, password:$("password").value });
    saveSession(r);
    signedIn = true;
    enterApp();
    await refresh();
  } catch (err) {
    $("password").value = "";
    // Anything that fails after enterApp() has to be reported inside the app:
    // the sign-in card is hidden by then, so a message written there is a
    // message nobody sees, and the page just reads "Loading…" forever.
    if (signedIn) return showFailure(err);
    $("signinMsg").innerHTML = `<div class="msg msg-bad">${esc(err.message)}</div>`;
  } finally { b.disabled = false; b.textContent = "Sign in"; }
});

function enterApp() {
  $("signinView").classList.add("hidden"); $("appView").classList.remove("hidden");
  $("whoName").textContent = USER.name || USER.email;
}

$("signoutBtn").addEventListener("click", async () => { try { await api("logout"); } catch {} clearSession(); location.reload(); });

$("pwBtn").addEventListener("click", async () => {
  const cur = prompt("Current password:"); if (!cur) return;
  const nw = prompt("New password (at least 12 characters):"); if (!nw) return;
  if (nw !== prompt("Type the new password again:")) return alert("Those didn't match.");
  try { await api("change_password", { current_password: cur, new_password: nw }); alert("Password changed."); }
  catch (e) { alert(e.message); }
});

document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  TAB = t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", String(x === t)));
  PANELS.forEach(p => $("panel-"+p).classList.toggle("hidden", p !== TAB));
  // Completed is not part of the dashboard payload, so it fetches on first
  // view rather than on every refresh.
  if (TAB === "completed" && !C) loadCompleted();
  if (TAB === "asks" && !A) loadAsks();
  if (TAB === "followups" && !F) loadFollowups();
  if (TAB === "docs" && !DOCS) loadDocs();
  if (TAB === "letters" && !L) loadLetters();
  updateLede();
}));

const PANELS = ["bloomerang","gala","letters","asks","followups","docs","completed"];

async function refresh() {
  PANELS.forEach(p => $("panel-"+p).innerHTML = `<div class="loading">Loading…</div>`);
  try {
    // The task list still loads even though Today is gone: Asks builds its
    // "not drafted yet" list from it and Follow ups its candidates. It is not
    // awaited, and it swallows its own failure, so the Bloomerang queue never
    // waits on it.
    loadTasks();
    D = await api("dashboard"); render();
  }
  catch (e) {
    // 401 means the session is gone: return to sign-in rather than offering a
    // retry that can only fail. Anything else is treated as "server
    // unreachable" — show one failure state across every panel with a retry.
    if (e.status === 401) return backToSignin("Your session has ended. Please sign in again.");
    showFailure(e);
  }
}

function backToSignin(msg) {
  clearSession();
  $("appView").classList.add("hidden");
  $("signinView").classList.remove("hidden");
  $("signinMsg").innerHTML = msg ? `<div class="msg msg-bad">${esc(msg)}</div>` : "";
  $("password").value = "";
}

function showFailure(e) {
  $("lede").textContent = "Can't reach the server.";
  $("ledeSub").textContent = "Nothing has been lost. This is usually a brief network problem.";
  ["cB","cG","cL"].forEach(id => $(id).textContent = "—");
  const detail = e && e.message ? e.message : "";
  const html = `<div class="empty">
      <b>The dashboard couldn't load.</b>
      <p>The server didn't answer. Try again in a moment.${detail ? `<br><span class="meta">${esc(detail)}</span>` : ""}</p>
      <div class="controls controls-center">
        <button class="btn btn-sm" data-retry="1">Try again</button>
      </div></div>`;
  // Asks, Follow ups, Needs editing and Completed have their own endpoints and
  // their own failure states; a donor-ops outage should not blank a panel that
  // loaded fine from somewhere else.
  ["bloomerang","gala"].forEach(p => $("panel-"+p).innerHTML = html);
}

// The task list has no panel of its own since Today was folded away, but three
// panels still read it: Asks builds its "not drafted yet" list from T.tasks,
// Follow ups its candidates, and Completed takes its end date from T.today.
// So it loads with the dashboard and re-renders whatever is already on screen.
//
// It never throws. Every consumer already falls back when T is null, and
// refresh() calls this without awaiting it — a task-list outage must not cost
// Erica the Bloomerang queue. A 401 is the one exception worth surfacing: the
// session is gone and no other call will succeed either.
async function loadTasks() {
  try {
    T = await tsk("list");
    if (A) renderAsks();
    if (F) renderFollowups();
    updateLede();
  } catch (e) {
    if (e.status === 401) backToSignin("Your session has ended. Please sign in again.");
  }
}

// The lede sits above every panel, so it has to describe whichever tab is
// open. Reading it from the donor-ops payload alone announced "Nothing is
// waiting on you." over a Today list with five open asks.
function updateLede() {
  const lede = $("lede"), sub = $("ledeSub");
  const set = (h, t) => { lede.textContent = h; sub.textContent = t; };

  if (TAB === "bloomerang") {
    if (!D) return set("Loading\u2026", "");
    const pend = (D.inbox||[]).filter(i => ["needs_review","approved","failed"].includes(i.status));
    return set(pend.length === 0 ? "Nothing is waiting to go to Bloomerang."
                                 : `${pend.length} ${pend.length === 1 ? "record" : "records"} waiting on you.`,
      pend.length === 0 ? "The scan runs at 8am, noon and 5pm."
                        : "Each one is approved on its own. Nothing is sent until you press the button.");
  }
  if (TAB === "gala") {
    if (!D) return set("Loading\u2026", "");
    const committed = (D.sponsors||[]).reduce((n,x) => n + Number(x.amount||0), 0);
    return set("An Evening to SPARCle \u2014 14 November 2026",
      `${money(committed)} committed across ${(D.sponsors||[]).length} sponsors.`);
  }
  if (TAB === "letters") {
    if (!L) return set("Loading\u2026", "");
    const owed = (L.needs_letter || []).length;
    return set(owed === 0 ? "Everyone has been thanked." : `${owed} owed a thank-you letter.`,
      "Written against Debi's rules. Never emailed to the donor.");
  }
  if (TAB === "asks") {
    if (!A) return set("Loading\u2026", "");
    const n = A.counts.draft + A.counts.staged;
    return set(n === 0 ? "No answers drafted." : `${n} ${n === 1 ? "answer" : "answers"} drafted.`,
      A.counts.flagged > 0
        ? `${A.counts.flagged} ${A.counts.flagged === 1 ? "has a flag" : "have flags"} to check before sending.`
        : "Approve the ones you are happy with, then create the draft.");
  }
  if (TAB === "followups") {
    const n = F ? (F.rows || []).filter(r => r.status === "draft").length : 0;
    return set(n === 0 ? "Nothing to follow up." : `${n} ${n === 1 ? "follow up" : "follow ups"} ready.`,
      "Each one sends on its own approval.");
  }
  if (TAB === "docs") {
    if (!DOCS) return set("Loading\u2026", "");
    const n = DOCS.counts.needs_human, rows = (DOCS.rows || []).length;
    return set(rows === 0 ? "No documents waiting."
                          : `${rows} ${rows === 1 ? "document" : "documents"} back from Debi.`,
      n === 0 ? "Nothing outstanding on them." : `${n} ${n === 1 ? "change needs" : "changes need"} your eye.`);
  }
  if (TAB === "completed") {
    const n = C ? (C.rows || []).length : 0;
    return set(n === 0 ? "Nothing completed in this range." : `${n} completed.`,
      "Grouped by the day it was finished.");
  }
}

function render() {
  updateLede();
  renderBloomerang(); renderGala();
}

// A queued row's `source` says what the sweep decided it is. Everything in the
// Bloomerang tab is grouped by it, so a grant never sits in the middle of the
// donations and get skimmed past.
const GIFT_SECTIONS = [
  { key: "debi_request", title: "Debi asked for these",  hot: true  },
  { key: "donation",     title: "Donations",             hot: false },
  { key: "sponsorship",  title: "Sponsorships",          hot: false },
  { key: "grant",        title: "Grants",                hot: false },
  { key: "scan",         title: "From the check sweep",  hot: false },
];
const SOURCE_TITLE = Object.fromEntries(GIFT_SECTIONS.map(x => [x.key, x.title]));

// ------------------------------------------------------------ bloomerang
// Everything on a queued row is editable before it goes anywhere. What the
// sweep or the ask extracted is a starting point, not a fact: the note can be
// rewritten and the person's details corrected, and only then does one button
// send it.
//
// The two halves are deliberately separate calls. Creating the constituent
// uses the backend's own upsert_constituent and there is no undo for it, so it
// is confirmed by name on its own. Pushing the note goes through approve,
// which merges payload_overrides over the stored payload before writing.

// Erica's calendar date, not UTC — a note dated by toISOString() lands on
// yesterday for the whole of her evening.
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// The person or organisation an ask wants created. Fields the email did not
// state are left empty rather than guessed at, and say so in the placeholder —
// but every one of them can be typed into before the record is created.
const CFIELDS = [["first_name","First name","text"], ["last_name","Last name","text"],
                 ["organization","Organisation","text"], ["email","Email","email"], ["phone","Phone","tel"]];

// An address inside SPARC is never the donor's. Micron's grant email came from
// Debi, and seeding that would have written a SPARC address onto Micron's
// record, so an internal sender is dropped rather than offered.
const INTERNAL_SENDER = /@sparcsolutions\.org$/i;

// What to prefill the create form with.
//
// A row routed here by an ask carries an explicit `extraction.constituent`
// block. A gift row — a donation, sponsorship or grant off the mail scan — does
// not, and used to get no create form at all: the card offered a bare account
// number box and nothing else, so an unmatched grant from Micron could not be
// added without leaving the dashboard. This falls back to what the extraction
// actually read out of the email. Nothing is invented; a field the email did
// not state stays empty and says so.
function constituentSeed(i) {
  const c = i.extraction?.constituent;
  const x = i.extraction || {};
  const email = i.from_email && !INTERNAL_SENDER.test(i.from_email) ? i.from_email : "";
  if (c) return { first_name:"", last_name:"", organization:"", phone:"", email, ...c };

  const org = x.donor_organization || "";
  const person = String(x.donor_name || "").trim();
  if (!org && !person) return null;
  const parts = person ? person.split(/\s+/) : [];
  return {
    first_name: parts.length > 1 ? parts.slice(0, -1).join(" ") : "",
    last_name:  parts.length > 1 ? parts[parts.length - 1] : (org ? "" : (parts[0] || "")),
    organization: org,
    email, phone: "",
  };
}

function blmConstituent(i) {
  if (i.match_constituent_id) return "";
  const c = constituentSeed(i);
  if (!c) return "";
  // The backend reads an organisation as "organisation set, no last name", so
  // the two are offered as separate writes: a grant from a foundation is the
  // foundation's record, and the person who emailed is a second one.
  const hasOrg = !!c.organization, hasPerson = !!(c.last_name || c.first_name);
  return `<div class="blm-block">
      <b>Nothing matched this one. Add it to Bloomerang.</b>
      <p class="meta">Only what the email actually stated is filled in. Correct anything
        that is wrong and fill in what is missing before you create the record.</p>
      <div class="blm-grid">
        ${CFIELDS.map(([k, label, type]) => `<div>
          <label for="bc${k}${i.id}">${label}</label>
          <input class="field" id="bc${k}${i.id}" data-blm-c="${k}" type="${type}"
                 value="${esc(c[k] || "")}" placeholder="not stated in the email">
        </div>`).join("")}
      </div>
      <div class="controls note-controls">
        ${hasOrg ? `<button class="btn btn-quiet btn-sm" data-blm-new="${i.id}" data-blm-mode="org">Create the organisation</button>` : ""}
        ${hasPerson ? `<button class="btn btn-quiet btn-sm" data-blm-new="${i.id}" data-blm-mode="person">Create the person</button>` : ""}
        ${!hasOrg && !hasPerson ? `<button class="btn btn-quiet btn-sm" data-blm-new="${i.id}" data-blm-mode="auto">Create this constituent</button>` : ""}
        <span class="meta">Creates the record, then fills in the account number below.</span>
      </div>
      ${hasOrg && hasPerson ? `<p class="meta">Both are here. The organisation is the donor;
        the person who emailed is a separate record, so create each one you need.</p>` : ""}
    </div>`;
}

// The note itself, editable. Only note rows get an editor: interaction and
// task rows have a different payload shape and nothing here knows it, so they
// keep the read-only card they had.
//
// An absent Note is left absent. The sweep proposed no text for the three rows
// currently queued, and prefilling the box from the raw email body would put
// words on a donor record that nobody wrote.
function blmNote(i) {
  if ((i.record_type ?? "note") !== "note") return "";
  const p = i.proposed_payload || {};
  const date = (p.Date || "").slice(0, 10) || (i.received_at || "").slice(0, 10) || todayISO();
  return `<div class="blm-block">
      <label for="bn${i.id}">Note to write on the constituent record</label>
      <textarea class="field" id="bn${i.id}" data-blm-note rows="5"
        placeholder="Nothing was drafted for this one. Write the note you want on the record.">${esc(p.Note || "")}</textarea>
      <div class="controls">
        <label class="tight" for="bd${i.id}">Date on the note</label>
        <input class="field med" id="bd${i.id}" data-blm-date type="date" value="${esc(date)}">
        <span class="meta">When the note is filed, not when the gift was given.</span>
      </div>
    </div>`;
}

// The money the sweep found, sectioned by what it decided each one is, and a
// The date the gift was GIVEN, which is not the date the email arrived. The
// extractor finds it only when the email states it, and on every row currently
// queued it did not — so this is the box that reads as "why am I typing a date
// again", next to the note's own date which is prefilled.
//
// It stays empty rather than being filled from received_at: a gift date is a
// fact about the gift, and quietly substituting the email's date would put a
// wrong date on a receipt. The email date is offered as one click instead, so
// accepting it is Erica's decision and not the app's guess.
function giftDateField(i, x) {
  const val = (x.gift_date || "").slice(0, 10);
  const mail = (i.received_at || "").slice(0, 10);
  return `<div>
      <label for="gfgift_date${i.id}">Date the gift was given</label>
      <input class="field" id="gfgift_date${i.id}" data-gift="gift_date" type="date"
             value="${esc(val)}" placeholder="not stated in the email">
      ${!val && mail
        ? `<button class="quote-toggle" data-use-date="${i.id}:${esc(mail)}">Use the email date, ${esc(day(mail))}</button>`
        : ""}
    </div>`;
}

// gift card per row. Everything is editable before it is sent; nothing here
// reaches Bloomerang without the button being pressed.
function giftFields(i) {
  const x = i.extraction || {};
  if (!["donation","sponsorship","grant"].includes(i.source)) return "";
  const f = (k, label, type, val, ph) => `<div>
      <label for="gf${k}${i.id}">${label}</label>
      <input class="field" id="gf${k}${i.id}" data-gift="${k}" type="${type}"
             value="${esc(val ?? "")}" placeholder="${esc(ph)}"></div>`;
  return `<div class="blm-block">
      <b>${esc(SOURCE_TITLE[i.source] || i.source)}</b>
      <p class="hint">Read out of the email. Correct anything wrong before you send it.
        ${x.confidence != null ? `Confidence ${Math.round(Number(x.confidence)*100)}%.` : ""}</p>
      <div class="blm-grid">
        ${f("donor_name","Donor","text",x.donor_name,"not stated in the email")}
        ${f("donor_organization","Organisation","text",x.donor_organization,"not stated in the email")}
        ${f("amount","Amount","number",x.amount,"not stated — fill in")}
        ${giftDateField(i, x)}
        ${f("designation","Designation","text",x.designation,"not stated")}
        ${i.source === "sponsorship" ? f("sponsor_level","Level","text",x.sponsor_level,"not stated") : ""}
        ${x.method === "check" ? f("check_number","Check no.","text",x.check_number,"not stated") : ""}
      </div>
      ${x.evidence ? `<div class="task-quote">\u201c${esc(x.evidence)}\u201d</div>` : ""}
      ${x.model_notes ? `<div class="meta">${esc(x.model_notes)}</div>` : ""}
    </div>`;
}

function giftCard(i) {
  const x = i.extraction || {};
  const who = x.donor_organization || x.donor_name || i.from_name || i.from_email || "(unknown)";
  const flags = (i.validation_flags || []).filter(f => f.endsWith("_missing"));
  return `<div class="card" data-card="${i.id}">${waitBlock(daysSince(i.received_at))}
      <div>
        <div class="who-line">${esc(who)}${x.amount != null ? ` \u2014 ${money(x.amount)}` : ""}</div>
        <div class="ask">${esc(i.subject || "(no subject)")}</div>
        <div class="task-meta">
          ${i.match_constituent_id
            ? `<span class="flag flag-ok">Matched #${i.match_constituent_id}</span>`
            : `<span class="flag flag-warn">No constituent match</span>`}
          ${flags.map(f => `<span class="flag flag-warn">${esc(f.replace("_"," "))}</span>`).join("")}
          ${i.extraction?.from_task_id ? `<span class="flag flag-ask">From Debi's ask</span>` : ""}
          <span>${day(i.received_at)}</span>
        </div>
        ${blmConstituent(i)}
        ${giftFields(i)}
        ${blmNote(i)}
        <div class="controls">
          ${i.match_constituent_id
            ? `<span class="state s-ok">Matched #${i.match_constituent_id}</span>`
            : `<span class="state s-bad" id="ms${i.id}">Looking for a match\u2026</span>
               <input class="field med" data-field="_accountNumber" type="number" placeholder="Account #">`}
          <button class="btn btn-go btn-sm" data-approve="${i.id}" ${i.status==="approved"?"disabled":""}>Send to Bloomerang</button>
          <button class="btn btn-quiet btn-sm" data-reject="${i.id}">Not a gift</button>
          <div class="spacer"></div>
          ${i.gmail_permalink ? `<a class="btn btn-quiet btn-sm" href="${esc(i.gmail_permalink)}" target="_blank" rel="noopener">Open email</a>`:""}
        </div>
        ${i.push_error ? `<div class="note note-bad">${esc(i.push_error).slice(0,300)}</div>`:""}
        <div class="meta">status ${esc(i.status)}</div>
        <div class="result"></div>
      </div></div>`;
}

// gift-scan stages every donation, sponsorship and grant with match_constituent_id
// NULL — it has no matching step at all — so the card read "No constituent match"
// even for a donor who is plainly in Bloomerang, and bloomerang.approve then
// refused the push with the same words. Creating a record from that screen makes
// a duplicate of a constituent that already exists, which is how this database
// came to hold two to four records for most donors.
//
// So the match is looked up here, per unmatched row, against the canonical
// matcher in the bloomerang function. A confident hit (a confirmed sender
// mapping, or a unique email) fills the account number in. A name-only hit is
// offered but NOT filled in: a wrong account writes a gift onto the wrong
// donor's record, so that one needs a human to agree to it.
const MATCH_CONFIDENT = 0.9;

async function findMatches(rows) {
  for (const i of rows) {
    if (i.match_constituent_id) continue;
    const el = $("ms" + i.id);
    if (!el) continue;
    const x = i.extraction || {};
    const name = x.donor_organization || x.donor_name || null;
    const email = x.donor_email || null;
    if (!name && !email) { el.textContent = "No name to match on"; continue; }
    try {
      const m = await blm("match", { name: name || undefined, email: email || undefined });
      const card = el.closest(".card");
      const field = card?.querySelector('[data-field="_accountNumber"]');
      if (m.account_number == null) {
        el.className = "state s-bad";
        el.textContent = m.method === "ambiguous_name"
          ? `${(m.candidates || []).length} records share that name` : "No match on file";
        return;
      }
      if ((m.score ?? 0) >= MATCH_CONFIDENT) {
        if (field) field.value = m.account_number;
        el.className = "state s-ok";
        el.textContent = `Matched #${m.account_number}`;
        el.title = m.method;
      } else {
        el.className = "state s-warn";
        el.innerHTML = `Likely #${esc(m.account_number)} `
          + `<button class="quote-toggle" data-use-acct="${i.id}:${esc(m.account_number)}">use it</button>`;
        el.title = m.method;
      }
    } catch { el.textContent = "Match lookup failed"; }
  }
}

function renderBloomerang() {
  const rows = (D.inbox||[]).filter(i => ["needs_review","approved","failed","pushed"].includes(i.status));
  // Fired after the panel is painted, so the cards exist to write into. Not
  // awaited: a slow match lookup must not hold up the queue rendering.
  setTimeout(() => findMatches(rows.filter(i => i.status !== "pushed")), 0);
  const pend = rows.filter(i => i.status !== "pushed")
                   .sort((a,b) => new Date(b.received_at||0) - new Date(a.received_at||0));
  const pushed = rows.filter(i => i.status === "pushed");
  const guests = (D.rsvp_candidates || []).filter(g => g.status === "needs_review");
  $("cB").textContent = pend.length;

  const bySection = GIFT_SECTIONS.map(sec => {
    const items = pend.filter(i => (i.source || "scan") === sec.key);
    if (!items.length) return "";
    return `<div class="sec"><h2>${sec.title}</h2><span class="pill ${sec.hot ? "pill-amber" : "pill-blue"}">${items.length}</span></div>`
      + items.map(giftCard).join("");
  }).join("");

  $("panel-bloomerang").innerHTML = `
    <div class="tiles">
      <div class="tile tile-amber"><b>${pend.filter(i=>i.source==="debi_request").length}</b><span>From Debi</span></div>
      <div class="tile"><b>${pend.filter(i=>i.source==="donation").length}</b><span>Donations</span></div>
      <div class="tile"><b>${pend.filter(i=>i.source==="sponsorship").length}</b><span>Sponsorships</span></div>
      <div class="tile"><b>${pend.filter(i=>i.source==="grant").length}</b><span>Grants</span></div>
      <div class="tile tile-green"><b>${pushed.length}</b><span>Already sent</span></div>
    </div>
    <div class="controls">
      <span class="meta">The scan runs at 8am, noon and 5pm. Each record is approved on its own \u2014 there is no bulk send.</span>
    </div>
    ${bySection || `<div class="empty"><b>Nothing is waiting to go to Bloomerang.</b>
       <p>The next scan runs at 8am, noon and 5pm.</p></div>`}

    ${guests.length ? `<div class="sec"><h2>Guests found in email</h2><span class="pill pill-blue">${guests.length}</span></div>` +
      guests.map(g => `<div class="card" data-card="${g.id}">${waitBlock(daysSince(g.received_at))}
        <div><div class="who-line">${esc([g.proposed?.title,g.proposed?.first_name,g.proposed?.last_name].filter(Boolean).join(" ") || "(name unclear)")}</div>
        <div class="ask">Requested by ${esc(g.requested_by || "unknown")} \u2014 add as a comped guest?</div>
        ${g.raw_excerpt ? `<div class="excerpt">${esc(g.raw_excerpt)}</div>` : ""}
        <div class="controls">
          <button class="btn btn-go btn-sm" data-guest-yes="${g.id}">Add to RSVP list</button>
          <button class="btn btn-quiet btn-sm" data-guest-no="${g.id}">Not a guest</button>
          <div class="spacer"></div>
          ${g.gmail_permalink ? `<a class="btn btn-quiet btn-sm" href="${esc(g.gmail_permalink)}" target="_blank" rel="noopener">Open email</a>`:""}
        </div><div class="result"></div></div></div>`).join("") : ""}

    ${pushed.length ? `<div class="sec"><h2>Already in Bloomerang</h2></div>
      <div class="tablewrap"><table><thead><tr><th>Who</th><th>Type</th><th>Subject</th><th>Sent</th><th></th></tr></thead><tbody>
      ${pushed.map(i=>`<tr>
        <td>${esc(i.extraction?.donor_organization || i.extraction?.donor_name || i.from_name || "\u2014")}</td>
        <td>${esc(SOURCE_TITLE[i.source] || i.record_type || "note")}</td>
        <td>${esc(i.subject||"\u2014")}</td><td class="num">${day(i.pushed_at)}</td>
        <td><button class="link" data-undo="${i.id}">Undo</button></td></tr>`).join("")}
      </tbody></table></div>`:""}`;
}

// ----------------------------------------------------- shared helpers
// Donor names reach two tables from different places and rarely match
// character for character: a trailing space, "Smith & Sons" against "Smith and
// Sons", a doubled space. Matching on a normalised key stops a letter that did
// go out from being reported as never sent.
const nameKey = s => String(s ?? "").toLowerCase().replace(/&/g, " and ")
  .replace(/['\u2019.]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const letterFor = name => {
  const k = nameKey(name); if (!k) return null;
  return (D.letters || []).find(x => nameKey(x.donor_display_name) === k) || null;
};

// One CSV builder for every download in the app.
function toCSV(cols, rows) {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.map(q).join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n");
}
function saveCSV(name, cols, rows) {
  const blob = new Blob(["\ufeff" + toCSV(cols, rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------- Gala 2026
// Every gala list in one place, each one downloadable. The figures come from
// the dashboard payload, which reads the real tables — not from a spreadsheet
// kept by hand.
//
// GALA_SUB is which list is showing. It is module state rather than a URL
// fragment because the whole app is one page with no router.
let GALA_SUB = "sponsors";

const GALA_LISTS = () => {
  const sponsors = (D.sponsors || []).slice()
    .sort((a,b) => new Date(b.sponsorship_date||0) - new Date(a.sponsorship_date||0));
  const rsvps = (D.rsvps || []).slice();
  const auction = (D.auction || []).slice();
  return {
    sponsors: {
      title: "Sponsors", rows: sponsors,
      cols: ["Organisation","First name","Last name","Level","Amount","Date","Campaign","Contacted by","Thank you"],
      cells: s => [s.organization||"", s.first_name||"", s.last_name||"", s.level||"",
                   s.amount ?? "", (s.sponsorship_date||"").slice(0,10), s.campaign||"",
                   s.contacted_by||"", s.thank_you_sent ? "Sent" : "Not sent"],
      total: sponsors.reduce((n,s) => n + Number(s.amount || 0), 0),
    },
    rsvps: {
      title: "RSVPs", rows: rsvps,
      cols: ["Title","First name","Last name","Email","Tickets","Amount","VIP","Guests"],
      cells: r => [r.title||"", r.first_name||"", r.last_name||"", r.email||"",
                   r.num_tickets ?? "", r.amount ?? "", r.is_vip ? "Yes" : "", r.guest_names||""],
      total: rsvps.reduce((n,r) => n + Number(r.amount || 0), 0),
    },
    auction: {
      title: "Auction items", rows: auction,
      cols: ["Donor","Contact","Email","Item","Market value","Event"],
      cells: a => [a.donor_business||"", a.contact_name||"", a.email||"",
                   a.item_description||"", a.market_value ?? "", a.event_name||""],
      total: auction.reduce((n,a) => n + Number(a.market_value || 0), 0),
    },
  };
};

function renderGala() {
  const lists = GALA_LISTS();
  const tickets = (D.rsvps || []).reduce((n,r) => n + Number(r.num_tickets || 0), 0);
  const committed = lists.sponsors.total;
  $("cG").textContent = lists.sponsors.rows.length;

  const cur = lists[GALA_SUB] || lists.sponsors;
  const blocked = (D.sponsors || []).filter(s => s.amount == null).length;

  const table = cur.rows.length
    ? `<div class="tablewrap"><table>
        <thead><tr>${cur.cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${cur.rows.map(r => `<tr>${cur.cells(r).map((v,n) =>
          `<td${n >= 4 && !isNaN(Number(v)) && v !== "" ? ' class="num"' : ""}>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>
       </table></div>`
    : `<div class="empty"><b>Nothing on this list yet.</b></div>`;

  $("panel-gala").innerHTML = `
    <div class="tiles">
      <div class="tile tile-green"><b>${money(committed)}</b><span>Committed</span></div>
      <div class="tile"><b>${lists.sponsors.rows.length}</b><span>Sponsors</span></div>
      <div class="tile"><b>${lists.rsvps.rows.length}</b><span>RSVPs</span></div>
      <div class="tile"><b>${tickets}</b><span>Tickets</span></div>
      <div class="tile ${blocked ? "tile-red" : ""}"><b>${blocked}</b><span>Missing an amount</span></div>
    </div>
    <div class="subtabs">
      ${Object.entries(lists).map(([k,v]) =>
        `<button class="subtab" data-gala="${k}" aria-selected="${String(k === GALA_SUB)}">${esc(v.title)} \u00b7 ${v.rows.length}</button>`).join("")}
    </div>
    ${table}
    <div class="controls">
      <button class="btn btn-quiet btn-sm" data-gala-csv="${GALA_SUB}">Download ${esc(cur.title.toLowerCase())}</button>
      <span class="meta">Read from the live tables. Bloomerang's own figure for the gala is on the Bloomerang tab.</span>
    </div>`;
}

// -------------------------------------------------------------- Completed
async function loadCompleted() {
  const to = CTO || (T && T.today) || new Date().toISOString().slice(0, 10);
  const from = CFROM || new Date(new Date(to + "T12:00:00Z").getTime() - 13 * 86400000).toISOString().slice(0, 10);
  CFROM = from; CTO = to;
  try { C = await tsk("completed", { from, to }); renderCompleted(); updateLede(); }
  catch (e) {
    if (e.status === 401) return backToSignin("Your session has ended. Please sign in again.");
    $("panel-completed").innerHTML = `<div class="empty"><b>Couldn't load completed tasks.</b>
      <p><span class="meta">${esc(e.message)}</span></p></div>`;
  }
}

function renderCompleted() {
  const rows = C.rows || [];
  $("cC").textContent = rows.length;

  // Grouped by the day the box was ticked, newest first.
  const byDay = new Map();
  rows.forEach(r => { if (!byDay.has(r.completed_on)) byDay.set(r.completed_on, []); byDay.get(r.completed_on).push(r); });

  const groups = [...byDay.entries()].map(([d, items]) => `
    <div class="daygroup">
      <h3>${esc(day(d))} · ${items.length} ${items.length === 1 ? "task" : "tasks"}</h3>
      ${items.map(r => `<div class="task">
        <span class="task-check" aria-hidden="true">✓</span>
        <div>
          <div class="task-title">${esc(r.title)}</div>
          <div class="task-meta">
            <span>${r.requested_by === "debi@sparcsolutions.org" ? "Debi" : esc(r.requested_by || "—")}</span>
            <span>asked ${day(r.requested_at)}</span>
          </div>
          ${r.source_quote ? `<div class="task-quote">“${esc(r.source_quote)}”</div>` : ""}
        </div><span></span>
      </div>`).join("")}
    </div>`).join("");

  $("panel-completed").innerHTML = `
    <div class="controls">
      <label for="cFrom" class="hidden">From</label>
      <input class="field med" id="cFrom" type="date" value="${esc(CFROM)}">
      <label for="cTo" class="hidden">To</label>
      <input class="field med" id="cTo" type="date" value="${esc(CTO)}">
      <button class="btn btn-sm" data-crange="1">Show</button>
      <span class="spacer"></span>
      <button class="btn btn-quiet btn-sm" data-tcsv="day">Download day</button>
      <button class="btn btn-quiet btn-sm" data-tcsv="week">Download week</button>
    </div>
    <div class="result note-controls"></div>
    ${rows.length ? groups : `<div class="empty"><b>Nothing completed in this range.</b>
      <p>Tasks appear here after the 5pm sweep on the day they were ticked.</p></div>`}`;
}

// A task CSV. Quotes are doubled and every field is quoted, because
// source_quote is Debi's prose and reliably contains commas and line breaks.
function taskCSV(rows, name) {
  const cols = ["completed_on", "title", "detail", "source_quote", "requested_by", "requested_at"];
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map(r => cols.map(c => cell(r[c])).join(","))].join("\r\n");
  // BOM so Excel opens the accented names and curly quotes correctly.
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}


// ---------------------------------------------------------------- Letters
// The thank-you letter engine has existed since 14 August and has never had a
// screen. `letters/list` returns the active formatting rules, the drafts, and
// the gifts that are owed one.
//
// Approving does four things in the backend's own order: writes the .docx to
// Drive, drafts the email to Debi with it attached, and (once the note and
// completion steps land) records both. Nothing is ever emailed to a donor.
async function loadLetters() {
  try { L = await call(LTR, "list"); renderLetters(); updateLede(); }
  catch (e) {
    if (e.status === 401) return backToSignin("Your session has ended. Please sign in again.");
    $("panel-letters").innerHTML = `<div class="empty"><b>Letters couldn't load.</b>
      <p><span class="meta">${esc(e.message)}</span></p>
      <div class="controls controls-center"><button class="btn btn-sm" data-letters-retry="1">Try again</button></div></div>`;
  }
}

const LETTER_STATE = { draft:"Drafted", in_drive:"Saved to Drive", drafted_to_debi:"Drafted to Debi", sent:"Sent", failed:"Failed" };

function owedRow(g) {
  const who = g.donor_display_name || g.donor_name || g.donor_organization || "(unnamed)";
  return `<div class="task" data-owed="${esc(g.donation_id ?? g.id ?? "")}">
    <span></span>
    <div>
      <div class="task-title">${esc(who)}${g.amount != null ? ` \u2014 ${money(g.amount)}` : ""}</div>
      <div class="task-meta">
        <span>${day(g.donation_date || g.gift_date)}</span>
        ${g.category ? `<span class="flag flag-due">${esc(g.category)}</span>` : ""}
        ${g.amount == null ? `<span class="flag flag-warn">no amount</span>` : ""}
        <button class="quote-toggle" data-letter-gen='${esc(JSON.stringify({
          donor_display_name: who, amount: g.amount, gift_date: (g.donation_date || g.gift_date || "").slice(0,10),
          gift_type: g.gift_type || undefined,
          // donation_ack_status exposes the donation as `id`. This read
          // `g.donation_id`, which the view does not have, so every letter went
          // off unlinked and the gift could never be marked as thanked.
          donation_id: g.id ?? g.donation_id ?? undefined,
        }))}'>Write the letter</button>
      </div>
      <div class="result"></div>
    </div><span></span>
  </div>`;
}

function letterCard(d) {
  const state = d.status || "draft";
  return `<div class="card-plain${state === "sent" ? " staged" : ""}" data-letter="${d.id}">
    <div class="task-title">${esc(d.donor_display_name || "(unnamed)")}${d.amount != null ? ` \u2014 ${money(d.amount)}` : ""}</div>
    <div class="task-meta">
      <span>${day(d.gift_date)}</span>
      <span class="flag ${state === "sent" ? "flag-ok" : state === "failed" ? "flag-warn" : "flag-due"}">${esc(LETTER_STATE[state] || state)}</span>
      ${d.gift_method === "check" ? `<span class="flag flag-blue">Check</span>` : ""}
      ${d.tribute ? `<span class="flag flag-ask">In memory of ${esc(d.tribute)}</span>` : ""}
      ${d.drive_docx_url ? `<a href="${esc(d.drive_docx_url)}" target="_blank" rel="noopener">Open in Drive</a>` : ""}
      ${d.gmail_draft_id ? `<a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noopener">Gmail draft</a>` : ""}
    </div>
    ${d.error ? `<div class="note note-bad">${esc(String(d.error).slice(0,300))}</div>` : ""}
    ${d.body_html ? `<div class="letterpage">${d.body_html}</div>` : ""}
    <div class="controls">
      ${state === "sent"
        ? `<span class="meta">Filed in the Thank You Letters folder.</span>`
        : `<button class="btn btn-go btn-sm" data-letter-sent="${d.id}">File as sent</button>
           <button class="btn btn-quiet btn-sm" data-letter-del="${d.id}">Delete draft</button>`}
      <div class="spacer"></div>
      <span class="meta">Filing only. Nothing is emailed \u2014 the draft to Debi is in Gmail
        for you to read and send.</span>
    </div>
    <div class="result"></div>
  </div>`;
}

function renderLetters() {
  const rules = L.rules || [], drafts = L.drafts || [], owed = L.needs_letter || [];
  $("cL").textContent = owed.length;
  const sent = drafts.filter(d => d.status === "sent").length;
  // Letters sitting in Drive with no draft to Debi yet — what the batch picks up.
  const batchMax = L.batch?.max ?? 3;
  const awaiting = L.batch?.awaiting ?? drafts.filter(d => d.status === "in_drive" && !d.gmail_draft_id).length;

  $("panel-letters").innerHTML = `
    <div class="tiles">
      <div class="tile tile-amber"><b>${owed.length}</b><span>Owed a letter</span></div>
      <div class="tile"><b>${drafts.length}</b><span>Drafted</span></div>
      <div class="tile tile-green"><b>${sent}</b><span>Sent to Debi</span></div>
      <div class="tile"><b>${rules.length}</b><span>Rules applied</span></div>
    </div>
    <div class="controls">
      ${awaiting ? `<button class="btn btn-sm" data-letters-batch="1">Draft ${Math.min(awaiting, batchMax)} to Debi</button>`
        : `<button class="btn btn-sm" data-letters-batch="1" disabled>Draft to Debi</button>`}
      <span class="meta">${awaiting
        ? `${awaiting} letter${awaiting === 1 ? "" : "s"} in Drive with no draft yet. Up to ${batchMax} go in one email.`
        : `Nothing is waiting in Drive without a draft.`}</span>
    </div>
    <div class="result note-controls" id="lettersResult"></div>

    ${drafts.length ? `<div class="sec"><h2>Drafted</h2><span class="pill pill-blue">${drafts.length}</span></div>`
      + drafts.map(letterCard).join("") : ""}

    <div class="sec"><h2>Owed a thank-you letter</h2><span class="pill pill-amber">${owed.length}</span></div>
    ${owed.length ? owed.map(owedRow).join("")
      : `<div class="empty"><b>Everyone has been thanked.</b></div>`}

    ${rules.length ? `<div class="sec"><h2>Debi's formatting rules</h2></div>
      <div class="tablewrap"><table><thead><tr><th class="num">#</th><th>Rule</th><th>Applies to</th></tr></thead><tbody>
      ${rules.map(r => `<tr><td class="num">${esc(r.id)}</td><td>${esc(r.rule)}</td><td>${esc(r.applies_to || "every letter")}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="meta">Held as data, so changing her mind is an edit to a row rather than a redeploy.</p>` : ""}`;
}

// ------------------------------------------------------------------- Asks
// One answer draft per ask from Debi. The flags are the point of this panel:
// the generator grades its own output and says what it could not source, and
// a bracketed placeholder means a human still has to fill a gap. Nothing here
// sends — approved answers assemble into one Gmail draft in Debi's numbering.

// An ask found by the mail scan carries the thread it came from, so a card can
// link back to it. Hand-added asks have no thread and get no link.
const GMAIL_THREAD = id => "https://mail.google.com/mail/u/0/#all/" + encodeURIComponent(id);

const FLAG_LABEL = {
  unsourced_claim: "Unsourced",
  missing_interpretation: "No interpretation",
  filler: "Filler",
  repeat_ask: "Asked before",
};
const FLAG_HELP = {
  unsourced_claim: "States something the thread does not support, or left a gap to fill. Check every specific before this goes out.",
  missing_interpretation: "Gives numbers without saying what they mean.",
  filler: "Words that add length but no information.",
  repeat_ask: "Debi has asked this more than once.",
};

async function loadAsks() {
  // The "not drafted yet" list is built from the Today task list, so make sure
  // it is loaded first. loadTasks() swallows its own failure and leaves T null,
  // which renderAsks() falls back from.
  try { if (!T) await loadTasks(); } catch {}
  try { A = await ask("list"); renderAsks(); updateLede(); }
  catch (e) {
    if (e.status === 401) return backToSignin("Your session has ended. Please sign in again.");
    $("panel-asks").innerHTML = `<div class="empty"><b>Answers couldn't load.</b>
      <p><span class="meta">${esc(e.message)}</span></p>
      <div class="controls controls-center"><button class="btn btn-sm" data-asks-retry="1">Try again</button></div></div>`;
  }
}

// A placeholder the model left for a human. Shown inline so an unfilled gap is
// visible in the draft rather than only in a flag.
function markGaps(text) {
  return esc(text).replace(/\[([^\]]{3,})\]/g, '<mark class="gap">[$1]</mark>');
}

function answerCard(a) {
  const t = a.task || {};
  const flags = (a.flags || []).map(f =>
    `<span class="flag flag-warn" title="${esc(FLAG_HELP[f] || "")}">${esc(FLAG_LABEL[f] || f)}</span>`).join("");
  const text = a.edited_draft ?? a.ai_draft ?? "";
  const staged = a.status === "staged";
  const idx = t.list_index ? `<span class="idx">#${esc(t.list_index)}</span>` : "";

  return `<div class="card-plain${staged ? " staged" : ""}" data-answer="${a.id}">
    <div class="task-title">${idx}${esc(t.title || "(task missing)")}</div>
    <div class="task-meta">
      <span>${day(t.requested_at)}</span>
      ${flags || '<span class="flag flag-ok">No flags raised</span>'}
      ${staged ? '<span class="flag flag-staged">Staged</span>' : ""}
      ${t.source_thread_id ? `<a href="${esc(GMAIL_THREAD(t.source_thread_id))}" target="_blank" rel="noopener">Open thread</a>` : ""}
    </div>
    ${t.source_quote ? `<div class="task-quote">“${esc(t.source_quote)}”</div>` : ""}
    <div class="answer-body" id="ab${a.id}">${markGaps(text)}</div>
    <textarea class="field answer-edit hidden" id="ae${a.id}" rows="7">${esc(text)}</textarea>
    <div class="controls">
      <button class="btn btn-quiet btn-sm" data-answer-edit="${a.id}">Edit</button>
      <button class="btn btn-quiet btn-sm hidden" data-answer-save="${a.id}">Save</button>
      <button class="btn btn-quiet btn-sm" data-answer-regen="${t.id}">Regenerate</button>
      <span class="spacer"></span>
      ${staged
        ? `<button class="btn btn-quiet btn-sm" data-answer-unstage="${a.id}">Unstage</button>`
        : `<button class="btn btn-go btn-sm" data-answer-approve="${a.id}">Approve</button>`}
      <button class="btn btn-quiet btn-sm" data-answer-dismiss="${a.id}">Dismiss</button>
    </div>
    <div class="result"></div>
  </div>`;
}

// Newest ask first. Within a single email Debi's numbering is the order she
// expects them answered in, so ties on the timestamp keep 1, 2, 11 ascending.
const byNewest = (a, b) => {
  const t = new Date(b.requested_at || 0) - new Date(a.requested_at || 0);
  if (t) return t;
  const ai = a.list_index != null ? Number(a.list_index) : NaN;
  const bi = b.list_index != null ? Number(b.list_index) : NaN;
  if (!isNaN(ai) && !isNaN(bi)) return ai - bi;
  if (!isNaN(ai)) return -1;
  if (!isNaN(bi)) return 1;
  return (b.id || 0) - (a.id || 0);
};

// Open asks with no answer drafted yet.
//
// Built from the Today list rather than from A.pending, because the asks
// endpoint sends only the OLDEST 100 pending tasks. Reversing that would show
// the oldest hundred backwards and leave the genuinely recent asks out of the
// payload entirely — the opposite of "most recent first". tasks/list returns
// every open task, so use it whenever it has loaded and fall back to the
// endpoint's own slice if it has not.
const PENDING_SHOWN = 50;
function pendingAsks() {
  const answered = new Set((A.answers || []).map(a => a.task_id));
  // Asks set aside, or already sent to Bloomerang, are still open tasks on
  // Today, so they arrive in T.tasks and have to be filtered out here too.
  const parked = new Set((A.parked || []).map(t => t.id));
  const full = !!(T && T.tasks);
  const rows = (full ? T.tasks.filter(t => t.status === "open") : (A.pending || []))
    .filter(t => !answered.has(t.id) && !parked.has(t.id)).slice().sort(byNewest);
  return { rows, full };
}

function renderAsks() {
  const c = A.counts;
  $("cA").textContent = c.draft + c.staged;

  const pending = pendingAsks();
  const shown = pending.rows.slice(0, PENDING_SHOWN);

  const pendingRows = shown.map(t => `<div class="task" data-pending="${t.id}">
      <span></span>
      <div>
        <div class="task-title">${t.list_index ? `<span class="idx">#${esc(t.list_index)}</span>` : ""}${esc(t.title)}</div>
        <div class="task-meta"><span>${day(t.requested_at)}</span>
          ${(t.ask_count || 1) > 1 ? `<span class="flag flag-ask">Asked ×${t.ask_count}</span>` : ""}
          ${t.source === "manual" || !t.source_thread_id
            ? `<span class="meta">added by hand — no thread to answer from</span>`
            : `<button class="quote-toggle" data-answer-regen="${t.id}">Draft an answer</button>`}
          <button class="quote-toggle" data-ask-del="${t.id}">Delete</button>
        </div>
        <div class="result"></div>
      </div><span></span>
    </div>`).join("");

  const more = pending.rows.length - shown.length;

  // Asks taken out of the panel. Shown rather than hidden, so nothing
  // disappears without a way back.
  const parked = (A.parked || []).slice().sort(byNewest);
  const parkedRows = parked.map(t => `<div class="task" data-pending="${t.id}">
      <span></span>
      <div>
        <div class="task-title">${t.list_index ? `<span class="idx">#${esc(t.list_index)}</span>` : ""}${esc(t.title)}</div>
        <div class="task-meta"><span>${day(t.requested_at)}</span>
          ${t.ask_state === "bloomerang"
            ? `<span class="flag flag-ok">In the Bloomerang queue</span>`
            : `<span class="flag">Set aside${t.ask_state_at ? " " + day(t.ask_state_at) : ""}</span>`}
          <button class="quote-toggle" data-ask-restore="${t.id}">Put it back</button>
        </div>
        <div class="result"></div>
      </div><span></span>
    </div>`).join("");

  $("panel-asks").innerHTML = `
    <div class="tiles">
      <div class="tile"><b>${c.draft}</b><span>Drafts</span></div>
      <div class="tile tile-green"><b>${c.staged}</b><span>Staged</span></div>
      <div class="tile tile-amber"><b>${c.flagged}</b><span>Flagged</span></div>
      <div class="tile"><b>${c.pending}</b><span>Not drafted</span></div>
    </div>
    <div class="controls">
      <button class="btn btn-sm" data-asks-draft="1"${c.staged ? "" : " disabled"}>Create Gmail draft${c.staged ? ` (${c.staged})` : ""}</button>
      <span class="meta">Assembles every staged answer into one draft to Debi, in her numbering. Never sends.</span>
    </div>
    <div class="result note-controls" id="asksResult"></div>
    ${A.answers.length
      ? A.answers.slice().sort((x, y) => byNewest(x.task || {}, y.task || {})).map(answerCard).join("")
      : `<div class="empty"><b>No answers drafted yet.</b><p>Pick an ask below and draft an answer to it.</p></div>`}
    <h2 class="sec">Not drafted yet${more > 0 ? ` — newest ${shown.length} of ${pending.rows.length}` : ""}</h2>
    ${pendingRows || `<div class="empty"><b>Every open ask has an answer.</b></div>`}
    ${parked.length ? `<h2 class="sec">Set aside — ${parked.length}</h2>
      <p class="meta">These are still open on Today. They are just not offered for an answer here.</p>
      ${parkedRows}` : ""}`;
}

// -------------------------------------------------------------- Follow Ups
async function loadFollowups() {
  try { F = await ask("followups"); renderFollowups(); updateLede(); }
  catch (e) {
    if (e.status === 401) return backToSignin("Your session has ended. Please sign in again.");
    $("panel-followups").innerHTML = `<div class="empty"><b>Follow ups couldn't load.</b>
      <p><span class="meta">${esc(e.message)}</span></p></div>`;
  }
}

function followupCard(r) {
  const t = r.task || {};
  const text = r.edited_draft ?? r.ai_draft ?? "";
  const sent = r.status === "sent";
  const gap = /\[[^\]]{3,}\]/.test(text);

  return `<div class="card-plain${sent ? " staged" : ""}" data-followup="${r.id}">
    <div class="task-title">${esc(r.target_name || "(no name)")}</div>
    <div class="task-meta">
      <span>Attempt ${r.attempt_no}</span>
      ${r.days_open != null ? `<span class="flag ${r.days_open > 7 ? "flag-old" : "flag-due"}">${r.days_open} days open</span>` : ""}
      ${r.tone === "firmer" ? '<span class="flag flag-warn">Firmer</span>' : ""}
      ${sent ? `<span class="flag flag-ok">Sent ${day(r.last_attempt_at)}</span>` : ""}
      ${gap ? '<span class="flag flag-warn">Has a gap to fill</span>' : ""}
    </div>
    <div class="task-meta"><span class="meta">${esc(t.title || "")}</span></div>
    <label for="fe${r.id}">To</label>
    <input class="field" id="fe${r.id}" type="email" value="${esc(r.target_email || "")}"
           placeholder="no address found in the thread — add one"${sent ? " disabled" : ""}>
    <label for="fs${r.id}">Subject</label>
    <input class="field" id="fs${r.id}" value="${esc(r.subject || "")}"${sent ? " disabled" : ""}>
    <textarea class="field" id="ft${r.id}" rows="8"${sent ? " disabled" : ""}>${esc(text)}</textarea>
    ${sent ? "" : `<div class="controls">
      <button class="btn btn-quiet btn-sm" data-fu-save="${r.id}">Save</button>
      <button class="btn btn-quiet btn-sm" data-fu-firmer="${t.id}">Firmer</button>
      <span class="spacer"></span>
      <button class="btn btn-go btn-sm" data-fu-send="${r.id}">Send</button>
      <button class="btn btn-quiet btn-sm" data-fu-dismiss="${r.id}">Dismiss</button>
    </div>`}
    ${sent ? `<div class="controls"><button class="btn btn-quiet btn-sm" data-fu-answered="${r.id}">Mark answered</button></div>` : ""}
    <div class="result"></div>
  </div>`;
}

function renderFollowups() {
  const rows = (F.rows || []).slice()
    .sort((a,b) => new Date(b.task?.requested_at || b.created_at || 0) - new Date(a.task?.requested_at || a.created_at || 0));
  $("cF").textContent = rows.filter(r => r.status === "draft").length;

  // Only tasks whose wording actually asks Erica to follow up with a named person
  // are candidates; the generator decides, and says no when nobody is named.
  const candidates = (T?.tasks || []).filter(t =>
    t.status === "open" && /follow up|check with|chase|reach out|circle back|touch base/i.test(t.title + " " + (t.detail || "")))
    .filter(t => !rows.some(r => r.task_id === t.id));

  $("panel-followups").innerHTML = `
    <div class="result note-controls" id="fuResult"></div>
    ${rows.length ? rows.map(followupCard).join("") : `<div class="empty">
      <b>Nothing to follow up.</b><p>Draft one from a task below that asks you to follow up with someone.</p></div>`}
    ${candidates.length ? `<h2 class="sec">Tasks that look like a follow up</h2>
      ${candidates.slice(0, 25).map(t => `<div class="task"><span></span><div>
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta"><span>${day(t.requested_at)}</span>
          <button class="quote-toggle" data-fu-gen="${t.id}">Draft a follow up</button></div>
      </div><span></span></div>`).join("")}` : ""}`;
}


// ---------------------------------------------------------- Needs editing
// Documents Debi sent back. Two kinds arrive together and both matter: the
// tracked changes inside a .docx, and the instructions she wrote in the email
// body — which for decks is the more common one.
//
// Nothing here has applied a change. Every instruction reads "needs your eye"
// until it is ticked off by a person, because claiming an edit was applied
// when it was not is worse than not offering to apply it at all.

const KIND_LABEL = { text: "Wording", image: "Image", slide: "Slide", formatting: "Formatting", data: "Figure", other: "Other" };

async function loadDocs() {
  try { DOCS = await doc("list"); renderDocs(); updateLede(); }
  catch (e) {
    if (e.status === 401) return backToSignin("Your session has ended. Please sign in again.");
    $("panel-docs").innerHTML = `<div class="empty"><b>Documents couldn't load.</b>
      <p><span class="meta">${esc(e.message)}</span></p>
      <div class="controls controls-center"><button class="btn btn-sm" data-docs-retry="1">Try again</button></div></div>`;
  }
}

function instructionRow(d, i, n) {
  const state = i.state || "needs_human";
  return `<div class="instr instr-${esc(state)}">
    <div>
      <div class="task-title">${esc(i.what || "(no summary)")}</div>
      <div class="task-meta">
        <span class="flag flag-due">${esc(KIND_LABEL[i.kind] || i.kind || "Other")}</span>
        ${i.target ? `<span class="flag flag-warn">${esc(String(i.target))}</span>` : ""}
        ${state === "needs_human" ? '<span class="flag flag-warn">Needs your eye</span>' : ""}
        ${state === "done" ? '<span class="flag flag-ok">Done</span>' : ""}
        ${state === "skipped" ? '<span class="flag">Skipped</span>' : ""}
      </div>
      ${i.quote ? `<div class="task-quote">“${esc(i.quote)}”</div>` : ""}
    </div>
    <div class="task-side">
      <button class="btn btn-quiet btn-sm" data-instr="${d.id}:${n}:done">Done</button>
      <button class="btn btn-quiet btn-sm" data-instr="${d.id}:${n}:skipped">Skip</button>
    </div>
  </div>`;
}

function docCard(d) {
  const instrs = d.instructions || [];
  const open = instrs.filter(i => (i.state || "needs_human") === "needs_human").length;
  return `<div class="card-plain" data-doc="${d.id}">
    <div class="task-title">${esc(d.filename)}</div>
    <div class="task-meta">
      <span class="flag flag-due">${esc(d.file_kind)}</span>
      ${d.tracked_change_count ? `<span class="flag flag-warn">${d.tracked_change_count} tracked changes</span>` : ""}
      ${instrs.length ? `<span class="flag flag-warn">${instrs.length} instruction${instrs.length === 1 ? "" : "s"}</span>` : ""}
      ${open ? `<span class="flag flag-old">${open} needing your eye</span>` : ""}
      <span class="flag ${d.status === "returned" ? "flag-ok" : ""}">${esc(d.status)}</span>
      ${d.attachment?.drive_url ? `<a href="${esc(d.attachment.drive_url)}" target="_blank" rel="noopener">Open the file</a>` : ""}
    </div>
    ${d.file_kind === "docx" ? `<div class="controls">
      ${d.tracked_change_count
        ? `<button class="btn btn-quiet btn-sm" data-doc-diff="${d.id}">Show her changes side by side</button>` : ""}
      <button class="btn btn-sm" data-doc-revise="${d.id}">${d.revision ? "Show the edits" : "Make her edits"}</button>
      ${d.revision ? `<span class="meta">${d.revision.applied} applied,
        ${d.revision.not_applied} not.</span>` : ""}
    </div>` : `<div class="controls"><span class="meta">A ${esc(d.file_kind)} has to be opened in its
        own application. Her instructions from the email are listed below.</span></div>`}
    <div class="diffwrap hidden" id="dw${d.id}"></div>
    <div class="revwrap hidden" id="rw${d.id}"></div>
    ${instrs.length ? `<h3 class="sec">What she asked for</h3>${instrs.map((i, n) => instructionRow(d, i, n)).join("")}` : ""}
    <div class="controls">
      <span class="spacer"></span>
      <button class="btn btn-quiet btn-sm" data-doc-mark="${d.id}:returned">Mark returned</button>
      <button class="btn btn-quiet btn-sm" data-doc-mark="${d.id}:dismissed">Dismiss</button>
    </div>
    <div class="result"></div>
  </div>`;
}

function renderDocs() {
  const c = DOCS.counts;
  $("cD").textContent = c.pending;
  $("panel-docs").innerHTML = `
    <div class="tiles">
      <div class="tile"><b>${(DOCS.rows || []).length}</b><span>Documents</span></div>
      <div class="tile tile-amber"><b>${c.needs_human}</b><span>Needing your eye</span></div>
      <div class="tile"><b>${c.tracked}</b><span>Tracked changes</span></div>
      <div class="tile"><b>${c.pending}</b><span>Still open</span></div>
    </div>
    <div class="controls">
      <button class="btn btn-sm" data-docs-scan="1">Look for new documents</button>
      <span class="meta">Nothing here edits a file. Her changes are shown so you can make them.</span>
    </div>
    <div class="result note-controls" id="docsResult"></div>
    ${(DOCS.rows || []).length ? DOCS.rows.map(docCard).join("")
      : `<div class="empty"><b>No documents waiting.</b>
         <p>Anything Debi sends back with a .docx or deck attached shows up here.</p></div>`}`;
}

// Debi's edits, applied, with what was NOT done and why, and the text open for
// Erica to change before it goes back.
//
// The two halves are deliberately labelled differently. Her tracked changes are
// read mechanically out of the .docx, so "applied" there is fact. Acting on her
// margin comments and the instructions in her email is a judgement, and the
// things it could not do — anything touching an image, a slide, a chart or the
// layout — are listed rather than quietly skipped.
function renderRevision(id, rev) {
  const wrap = $("rw" + id);
  const line = (a, cls) => `<div class="revrow ${cls}">
      <b>${esc(a.what || "(no summary)")}</b>
      ${a.where ? `<span class="meta"> in ${esc(a.where)}</span>` : ""}
      ${a.why ? `<span class="why">Not done: ${esc(a.why)}</span>` : ""}
      ${a.quote ? `<div class="task-quote">\u201c${esc(a.quote)}\u201d</div>` : ""}
    </div>`;
  const applied = rev.applied || [], notApplied = rev.not_applied || [];
  const text = rev.edited_text ?? rev.revised_text ?? "";
  const gap = /\[[^\]]{3,}\]/.test(text);

  wrap.innerHTML = `
    <h3 class="sec">What was changed (${applied.length})</h3>
    ${applied.length ? applied.map(a => line(a, "revdone")).join("")
      : `<div class="revrow"><span class="meta">Nothing was changed beyond her tracked changes.</span></div>`}

    ${notApplied.length ? `<h3 class="sec">Not done, and why (${notApplied.length})</h3>
      ${notApplied.map(a => line(a, "revopen")).join("")}` : ""}

    <h3 class="sec">The document, yours to edit</h3>
    ${gap ? `<div class="note note-warn">There is still a [placeholder] in here. Fill it in
      before this goes back \u2014 sending is refused while one is left.</div>` : ""}
    <textarea class="field revedit" id="rt${id}">${esc(text)}</textarea>
    <p class="meta">Rebuilt from the text, so the original formatting, images and layout are
      not carried over. The draft to Debi says so.</p>
    <div class="controls">
      <button class="btn btn-go btn-sm" data-doc-return="${id}">Draft it to Debi</button>
      <span class="meta">Makes a .docx and a Gmail draft. Nothing is sent \u2014 you send it.</span>
    </div>
    <div class="result" id="rr${id}"></div>`;
  wrap.classList.remove("hidden");
}

// Her version against the version with her changes applied. Deletions struck
// through in red, insertions in green, so the two columns read as one edit.
function renderDiff(id, d) {
  const side = which => (d.paragraphs || []).map(p => {
    const segs = (p.segs || []).filter(s => which === "orig" ? s.kind !== "ins" : s.kind !== "del");
    if (!segs.length) return "";
    return "<p>" + segs.map(s => {
      const t = esc(s.text);
      if (s.kind === "del") return `<del>${t}</del>`;
      if (s.kind === "ins") return `<ins>${t}</ins>`;
      return t;
    }).join("") + "</p>";
  }).join("");

  const comments = (d.comments || []).length
    ? `<h3 class="sec">Her comments (${d.comments.length})</h3>
       ${d.comments.map(c => `<div class="task-quote">“${esc(c.text)}”
          <div class="task-meta"><span>${esc(c.author || "unknown")}</span></div></div>`).join("")}`
    : "";

  $("dw" + id).innerHTML = `
    <div class="task-meta"><span>${d.insertions} inserted</span><span>${d.deletions} deleted</span></div>
    <div class="sbs">
      <div><h3 class="sec">Her version</h3><div class="docside">${side("orig")}</div></div>
      <div><h3 class="sec">With her changes</h3><div class="docside">${side("rev")}</div></div>
    </div>
    ${comments}`;
  $("dw" + id).classList.remove("hidden");
}

// --------------------------------------------------------------- actions
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-retry],[data-ask-del],[data-ask-restore],[data-blm-new],[data-approve],[data-reject],[data-undo],[data-guest-yes],[data-guest-no],[data-tcsv],[data-crange],[data-gala],[data-gala-csv],[data-letters-retry],[data-letter-gen],[data-letter-sent],[data-asks-retry],[data-asks-draft],[data-answer-edit],[data-answer-save],[data-answer-regen],[data-answer-approve],[data-answer-unstage],[data-answer-dismiss],[data-fu-gen],[data-fu-firmer],[data-fu-save],[data-fu-send],[data-fu-dismiss],[data-fu-answered],[data-docs-retry],[data-docs-scan],[data-doc-diff],[data-doc-mark],[data-instr],[data-use-date],[data-use-acct],[data-letter-del],[data-letters-batch],[data-doc-revise],[data-doc-return]");
  if (!t) return;
  const btn = t;

  // ---- Today and Completed. Handled before the donor-ops branches because
  // these read from their own endpoint and their own state.
  if (btn.dataset.quote) { $("q" + btn.dataset.quote)?.classList.toggle("hidden"); return; }
  if (btn.dataset.crange) {
    CFROM = $("cFrom").value || CFROM; CTO = $("cTo").value || CTO;
    return loadCompleted();
  }
  if (btn.dataset.tcsv) {
    const scope = btn.dataset.tcsv;
    const date = (TAB === "completed" ? CTO : (T && T.today)) || new Date().toISOString().slice(0, 10);
    try {
      const r = await tsk("export", { scope, date });
      if (!r.rows.length) { alert("Nothing completed in that range yet."); return; }
      taskCSV(r.rows, `SPARC tasks ${scope === "week" ? r.from + " to " + r.to : r.to}.csv`);
    } catch (err) { alert(err.message); }
    return;
  }
  // ---- Needs editing
  if (btn.dataset.docsRetry) return loadDocs();
  if (btn.dataset.docsScan) {
    const out = $("docsResult"); btn.disabled = true;
    const label = btn.textContent; btn.textContent = "Looking…";
    try {
      const r = await doc("scan", { days: 30 });
      out.innerHTML = `<div class="note note-ok">${r.queued} new ${r.queued === 1 ? "document" : "documents"} queued.</div>`;
      await loadDocs();
    } catch (err) { out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; }
    btn.disabled = false; btn.textContent = label;
    return;
  }
  if (btn.dataset.docDiff) {
    const id = btn.dataset.docDiff;
    const wrap = $("dw" + id);
    if (!wrap.classList.contains("hidden")) { wrap.classList.add("hidden"); return; }
    const label = btn.textContent; btn.disabled = true; btn.textContent = "Reading the file…";
    try { renderDiff(id, await doc("diff", { id: Number(id) })); }
    catch (err) { btn.closest(".card-plain").querySelector(".result").innerHTML =
      `<div class="note note-bad">${esc(err.message)}</div>`; }
    btn.disabled = false; btn.textContent = label;
    return;
  }
  if (btn.dataset.instr) {
    const [id, n, state] = btn.dataset.instr.split(":");
    const row = (DOCS.rows || []).find(r => String(r.id) === id);
    if (!row) return;
    // Send the whole list back with one entry changed: the column is a single
    // jsonb value, so a partial write would drop the others.
    const next = (row.instructions || []).map((i, k) =>
      String(k) === n ? { ...i, state: i.state === state ? "needs_human" : state } : i);
    btn.disabled = true;
    try { await doc("instructions_save", { id: Number(id), instructions: next }); await loadDocs(); }
    catch (err) { alert(err.message); btn.disabled = false; }
    return;
  }
  // Apply Debi's edits. `revise` is cached backend-side, so pressing this again
  // shows the stored revision rather than spending a second model call on a
  // whole document; the button says which it is doing.
  if (btn.dataset.docRevise) {
    const id = btn.dataset.docRevise;
    const wrap = $("rw" + id);
    if (!wrap.classList.contains("hidden")) { wrap.classList.add("hidden"); return; }
    const row = (DOCS.rows || []).find(r => String(r.id) === id);
    const out = btn.closest(".card-plain").querySelector(".result");
    const label = btn.textContent; btn.disabled = true;
    btn.textContent = row?.revision ? "Loading\u2026" : "Reading and editing\u2026";
    try {
      const r = await doc("revise", { id: Number(id) });
      if (r.nothing_to_apply) {
        out.innerHTML = `<div class="note note-warn">${esc(r.error)}</div>`;
      } else {
        REV[id] = r.revision || {};
        // The reload has to come FIRST. renderDocs() replaces the panel
        // wholesale, so a revision rendered before it is wiped a moment later.
        if (!r.cached) await loadDocs();
        renderRevision(id, REV[id]);
      }
    } catch (err) {
      out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`;
    }
    btn.disabled = false; btn.textContent = label;
    return;
  }

  // The edited text, back to Debi as a .docx on a Gmail draft. Never sent.
  if (btn.dataset.docReturn) {
    const id = btn.dataset.docReturn;
    const row = (DOCS.rows || []).find(r => String(r.id) === id);
    const text = $("rt" + id)?.value ?? "";
    const out = $("rr" + id);
    const say = (c, h) => { if (out) out.innerHTML = `<div class="note ${c}">${h}</div>`; };
    if (!text.trim()) return say("note-bad", "There is nothing to send.");
    if (!confirm("Draft this back to Debi?\n\nIt makes a .docx and a Gmail draft. "
      + "Nothing is sent — you read it and send it yourself.")) return;
    btn.disabled = true;
    const label = btn.textContent; btn.textContent = "Drafting\u2026";
    try {
      const r = await call(LTR, "return_document", {
        doc_revision_id: Number(id),
        title: (row?.filename || "Revised document").replace(/\.(docx|pptx|xlsx)$/i, ""),
        original_filename: row?.filename || null,
        heading: (row?.filename || "").replace(/\.(docx|pptx|xlsx)$/i, ""),
        text,
        // So the draft to Debi carries what was done and what was not.
        applied: REV[id]?.applied ?? [],
        not_applied: REV[id]?.not_applied ?? [],
      });
      // Reload first, then write the note into the panel-level result:
      // renderDocs() replaces the panel and would wipe a note written before it.
      await loadDocs();
      const panel = $("docsResult");
      if (panel) panel.innerHTML = `<div class="note note-ok">${esc(r.note || "Drafted to Debi.")}`
        + (r.drive_url ? ` <a href="${esc(r.drive_url)}" target="_blank" rel="noopener">Open the .docx</a>.` : "")
        + ` <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noopener">Open Gmail drafts</a>.`
        + `</div>`;
    } catch (err) {
      // A left-in placeholder is refused by the backend; surface it as guidance
      // rather than a failure, because the fix is one edit away.
      say(err.status === 422 ? "note-warn" : "note-bad", esc(err.message));
      btn.disabled = false; btn.textContent = label;
    }
    return;
  }

  if (btn.dataset.docMark) {
    const [id, status] = btn.dataset.docMark.split(":");
    if (status === "dismissed" && !confirm("Dismiss this document?")) return;
    btn.disabled = true;
    try { await doc("mark", { id: Number(id), status }); await loadDocs(); }
    catch (err) { alert(err.message); btn.disabled = false; }
    return;
  }

  // ---- Gala 2026
  //
  // Both of these were registered on the listener with no branch behind them,
  // so the sub-tabs did not switch and the download did nothing. saveCSV() was
  // sitting unused for the same reason.
  if (btn.dataset.gala) { GALA_SUB = btn.dataset.gala; renderGala(); return; }
  if (btn.dataset.galaCsv) {
    const lists = GALA_LISTS();
    const cur = lists[btn.dataset.galaCsv] || lists.sponsors;
    saveCSV("gala-" + btn.dataset.galaCsv, cur.cols, cur.rows.map(cur.cells));
    return;
  }

  // ---- Answers: approve, unstage, dismiss
  //
  // All three were dead. Approve is the one that matters most: nothing could
  // ever reach `staged`, so "Create Gmail draft" — which assembles the staged
  // answers into one mail in Debi's numbering — had nothing to assemble and the
  // whole Asks workflow stopped at the draft.
  if (btn.dataset.answerApprove || btn.dataset.answerUnstage) {
    const staging = !!btn.dataset.answerApprove;
    const id = btn.dataset.answerApprove || btn.dataset.answerUnstage;
    const out = btn.closest(".card-plain").querySelector(".result");
    btn.disabled = true;
    const label = btn.textContent; btn.textContent = staging ? "Approving\u2026" : "Unstaging\u2026";
    try { await ask(staging ? "approve" : "unstage", { id: Number(id) }); await loadAsks(); }
    catch (err) {
      out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = label;
    }
    return;
  }
  if (btn.dataset.answerDismiss) {
    const id = btn.dataset.answerDismiss;
    const out = btn.closest(".card-plain").querySelector(".result");
    // Dismissing an answer also parks its ask, so it does not come straight
    // back as "not drafted yet". Say so before it happens.
    if (!confirm("Dismiss this answer?\n\nThe ask is set aside too, so it stops being offered "
      + "here. It stays open on the task list, and you can put it back.")) return;
    btn.disabled = true;
    try { await ask("dismiss", { id: Number(id) }); await loadAsks(); }
    catch (err) { out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; btn.disabled = false; }
    return;
  }
  if (btn.dataset.askRestore) {
    const out = btn.closest(".task")?.querySelector(".result");
    btn.disabled = true;
    try { await ask("restore_task", { task_id: Number(btn.dataset.askRestore) }); await loadAsks(); }
    catch (err) {
      if (out) out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
    return;
  }

  // ---- Follow ups: dismiss, mark answered. Both were dead.
  if (btn.dataset.fuDismiss || btn.dataset.fuAnswered) {
    const answered = !!btn.dataset.fuAnswered;
    const id = btn.dataset.fuAnswered || btn.dataset.fuDismiss;
    const out = btn.closest(".card-plain")?.querySelector(".result");
    if (!answered && !confirm("Dismiss this follow up?")) return;
    btn.disabled = true;
    try {
      await ask(answered ? "followup_answered" : "followup_dismiss", { id: Number(id) });
      await loadFollowups();
    } catch (err) {
      if (out) out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
    return;
  }

  // ---- Letters
  //
  // These four had no handler at all. The buttons were registered on the
  // delegated listener and every branch was missing, so "Write the letter"
  // and "Mark sent to Debi" did nothing when pressed — which is why one
  // letter exists in the whole table and 44 gifts since March are still
  // unthanked. `list` was the only letters action the page ever called.
  if (btn.dataset.lettersRetry) return loadLetters();

  // Panel-level notes are written AFTER the reload, because renderLetters()
  // replaces the panel wholesale and would wipe a message written before it.
  const lettersNote = (cls, html) => {
    const o = $("lettersResult");
    if (o) o.innerHTML = `<div class="note ${cls}">${html}</div>`;
  };

  if (btn.dataset.letterGen) {
    let g; try { g = JSON.parse(btn.dataset.letterGen); } catch { return; }
    const out = btn.closest(".task")?.querySelector(".result");
    const local = (cls, m) => { if (out) out.innerHTML = `<div class="note ${cls}">${esc(m)}</div>`; };
    if (g.amount == null) return local("note-bad", "This gift has no amount. Fill that in first.");
    btn.disabled = true;
    const label = btn.textContent; btn.textContent = "Writing\u2026";
    try {
      // draft_email:false leaves it in Drive so up to three go to Debi at once.
      const r = await call(LTR, "generate", { ...g, draft_email: false });
      const found = r.address_source === "bloomerang";
      await loadLetters();
      lettersNote(found ? "note-ok" : r.address_source === "typed" ? "note-ok" : "note-warn",
        `Letter written for ${esc(g.donor_display_name)} and saved to Drive. `
        + (found ? `Address from Bloomerang (${esc(r.address_how || "matched")}).`
           : r.address_source === "typed" ? "Address as typed."
           : `<b>No address</b> \u2014 ${esc(r.address_how || "nothing matched")}. `
             + `Add it in the document before it goes out.`)
        + (r.drive_url ? ` <a href="${esc(r.drive_url)}" target="_blank" rel="noopener">Open it</a>.` : "")
        + ` Nothing has been emailed.`);
    } catch (err) {
      local("note-bad", err.message); btn.disabled = false; btn.textContent = label;
    }
    return;
  }

  if (btn.dataset.lettersBatch) {
    btn.disabled = true;
    const label = btn.textContent; btn.textContent = "Drafting\u2026";
    try {
      const r = await call(LTR, "draft_batch", {});
      await loadLetters();
      lettersNote("note-ok",
        `${r.count} letter${r.count === 1 ? "" : "s"} in one draft to Debi. `
        + `<a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noopener">Open Gmail drafts</a>. `
        + `Nothing has been sent \u2014 read it and send it yourself.`);
    } catch (err) {
      lettersNote("note-bad", esc(err.message));
      btn.disabled = false; btn.textContent = label;
    }
    return;
  }

  if (btn.dataset.letterSent) {
    if (!confirm("File this letter as sent?\n\nThis moves the .docx to your Sent folder in Drive. "
      + "It does not email anything.")) return;
    btn.disabled = true;
    try {
      const r = await call(LTR, "mark_sent", { id: btn.dataset.letterSent });
      await loadLetters();
      lettersNote("note-ok", esc(r.note || "Filed in the Sent folder."));
    } catch (err) { lettersNote("note-bad", esc(err.message)); btn.disabled = false; }
    return;
  }

  if (btn.dataset.letterDel) {
    if (!confirm("Delete this draft?\n\nThe Drive files go to trash, where Drive keeps them for 30 "
      + "days, and the Gmail draft is deleted.")) return;
    btn.disabled = true;
    try {
      const r = await call(LTR, "delete", { id: btn.dataset.letterDel });
      await loadLetters();
      lettersNote("note-ok", `Draft deleted.`
        + ((r.removed || []).length ? ` ${esc(r.removed.join("; "))}.` : "")
        + ((r.failed || []).length
            ? `<br><span class="meta">Could not remove ${esc(r.failed.join("; "))}.</span>` : ""));
    } catch (err) { lettersNote("note-bad", esc(err.message)); btn.disabled = false; }
    return;
  }

  // ---- Asks
  if (btn.dataset.asksRetry) return loadAsks();
  // Set an ask aside, or put it back. Neither touches the Today list.
  // "Delete" removes the task outright rather than parking it. The old
  // "Not answering this" only set ask_state, which left the item open on the
  // task list — hidden here but not gone, which is not what delete means.
  if (btn.dataset.askDel) {
    const out = btn.closest(".task")?.querySelector(".result");
    if (!confirm("Delete this ask? It will not appear in Completed.")) return;
    btn.disabled = true;
    try { await tsk("delete", { id: Number(btn.dataset.askDel) }); await loadTasks(); await loadAsks(); }
    catch (err) {
      if (out) out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; else alert(err.message);
      btn.disabled = false;
    }
    return;
  }
  for (const [key, action] of [["askRestore", "restore_task"]]) {
    if (btn.dataset[key]) {
      const out = btn.closest(".task")?.querySelector(".result");
      btn.disabled = true;
      try { await ask(action, { task_id: Number(btn.dataset[key]) }); await loadAsks(); }
      catch (err) {
        if (out) out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; else alert(err.message);
        btn.disabled = false;
      }
      return;
    }
  }
  // Route an "add this to Bloomerang" ask into the Bloomerang queue. This only
  // stages a draft — the push still needs her approval over on that tab.
  if (btn.dataset.askBlm) {
    const out = btn.closest(".task")?.querySelector(".result");
    const label = btn.textContent; btn.disabled = true; btn.textContent = "Reading the ask…";
    try {
      const r = await ask("to_bloomerang", { task_id: Number(btn.dataset.askBlm) });
      if (!r.is_bloomerang) {
        // The classifier declined. Say why and leave the ask where it is.
        if (out) out.innerHTML = `<div class="note note-bad">${esc(r.reason)}</div>`;
        btn.disabled = false; btn.textContent = label;
        return;
      }
      if (out) out.innerHTML = `<div class="note note-ok">${esc(r.summary || "Drafted.")} `
        + `Waiting for your approval under Bloomerang. Nothing has been sent.</div>`;
      // The draft now sits in the Bloomerang queue, so that panel is stale too.
      setTimeout(async () => { await loadAsks(); await refresh(); }, 900);
    } catch (err) {
      if (out) out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = label;
    }
    return;
  }
  if (btn.dataset.answerEdit) {
    const id = btn.dataset.answerEdit;
    $("ab" + id).classList.add("hidden");
    $("ae" + id).classList.remove("hidden");
    btn.classList.add("hidden");
    btn.parentElement.querySelector("[data-answer-save]").classList.remove("hidden");
    return;
  }
  if (btn.dataset.answerSave) {
    const id = btn.dataset.answerSave, out = btn.closest(".card-plain").querySelector(".result");
    btn.disabled = true;
    try { await ask("save", { id: Number(id), edited_draft: $("ae" + id).value }); await loadAsks(); }
    catch (err) { out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; btn.disabled = false; }
    return;
  }
  if (btn.dataset.answerRegen) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = "Drafting…";
    const out = btn.closest(".card-plain")?.querySelector(".result") || $("asksResult");
    try { await ask("generate", { task_id: Number(btn.dataset.answerRegen) }); await loadAsks(); }
    catch (err) {
      // A 422 here is the verification gate refusing to invent an answer with
      // nothing to source it from. That is the feature, so say it plainly.
      if (out) out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = label;
    }
    return;
  }
  for (const [key, action] of [["answerApprove","approve"],["answerUnstage","unstage"],["answerDismiss","dismiss"]]) {
    if (btn.dataset[key]) {
      const out = btn.closest(".card-plain").querySelector(".result");
      btn.disabled = true;
      try { await ask(action, { id: Number(btn.dataset[key]) }); await loadAsks(); }
      catch (err) { out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; btn.disabled = false; }
      return;
    }
  }
  if (btn.dataset.asksDraft) {
    const out = $("asksResult"); btn.disabled = true;
    const label = btn.textContent; btn.textContent = "Creating…";
    try {
      const r = await ask("create_draft");
      out.innerHTML = `<div class="note note-ok">${esc(r.note)} ${r.answers} ${r.answers === 1 ? "answer" : "answers"}. `
        + `<a href="${esc(r.gmail_url)}" target="_blank" rel="noopener">Open Gmail drafts</a></div>`;
      await loadAsks();
    } catch (err) { out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; }
    btn.disabled = false; btn.textContent = label;
    return;
  }

  // ---- Follow ups
  if (btn.dataset.fuGen || btn.dataset.fuFirmer) {
    const taskId = Number(btn.dataset.fuGen || btn.dataset.fuFirmer);
    const tone = btn.dataset.fuFirmer ? "firmer" : "normal";
    const label = btn.textContent; btn.disabled = true; btn.textContent = "Drafting…";
    const out = btn.closest(".card-plain")?.querySelector(".result") || $("fuResult");
    try {
      const r = await ask("followup_generate", { task_id: taskId, tone });
      if (!r.is_followup) {
        if (out) out.innerHTML = `<div class="note note-bad">${esc(r.reason)}</div>`;
        btn.disabled = false; btn.textContent = label; return;
      }
      await loadFollowups();
    } catch (err) {
      if (out) out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = label;
    }
    return;
  }
  if (btn.dataset.fuSave) {
    const id = btn.dataset.fuSave, out = btn.closest(".card-plain").querySelector(".result");
    btn.disabled = true;
    try {
      await ask("followup_save", { id: Number(id), edited_draft: $("ft" + id).value,
        subject: $("fs" + id).value, target_email: $("fe" + id).value });
      out.innerHTML = `<div class="note note-ok">Saved.</div>`;
    } catch (err) { out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; }
    btn.disabled = false;
    return;
  }
  if (btn.dataset.fuSend) {
    const id = btn.dataset.fuSend, out = btn.closest(".card-plain").querySelector(".result");
    const to = $("fe" + id).value.trim();
    // This sends a real email to someone outside SPARC, so it is confirmed
    // once, by name, and one at a time.
    if (!confirm(`Send this follow up to ${to || "(no address)"}?`)) return;
    btn.disabled = true;
    try {
      await ask("followup_save", { id: Number(id), edited_draft: $("ft" + id).value,
        subject: $("fs" + id).value, target_email: to });
      const r = await ask("followup_send", { id: Number(id) });
      out.innerHTML = `<div class="note note-ok">Sent to ${esc(r.sent_to)}.</div>`;
      setTimeout(loadFollowups, 600);
    } catch (err) { out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; btn.disabled = false; }
    return;
  }
  for (const [key, action] of [["fuDismiss","followup_dismiss"],["fuAnswered","followup_answered"]]) {
    if (btn.dataset[key]) {
      btn.disabled = true;
      try { await ask(action, { id: Number(btn.dataset[key]) }); await loadFollowups(); }
      catch (err) { alert(err.message); btn.disabled = false; }
      return;
    }
  }

  const card = btn.closest(".card") || btn.closest(".notebox");
  const out = card?.querySelector(".result");
  const say = (c, m) => { if (out) out.innerHTML = `<div class="note ${c}">${esc(m)}</div>`; };
  if (btn.dataset.retry) return refresh();
  // Accepting the email's date for the gift date. Fills the box and stops
  // there, so it still goes to Bloomerang only when Send is pressed.
  // Accepting a name-only constituent match. Fills the account number and stops
  // there, so it still reaches Bloomerang only when Send is pressed.
  if (btn.dataset.useAcct) {
    const [id, acct] = btn.dataset.useAcct.split(":");
    const card = document.querySelector(`[data-card="${id}"]`);
    const field = card?.querySelector('[data-field="_accountNumber"]');
    if (field) field.value = acct;
    const el = $("ms" + id);
    if (el) { el.className = "state s-ok"; el.textContent = `Using #${acct}`; }
    return;
  }
  if (btn.dataset.useDate) {
    const [id, iso] = btn.dataset.useDate.split(":");
    const el = document.getElementById("gfgift_date" + id);
    if (el) { el.value = iso; btn.remove(); }
    return;
  }
  // Create the constituent an ask asked for, from whatever is in the boxes at
  // the moment the button is pressed — not from the extraction, so a correction
  // she typed is the thing that gets written. Confirmed by name first: this
  // writes a new record into live donor data and there is no undo for it.
  if (btn.dataset.blmNew) {
    const get = k => card?.querySelector(`[data-blm-c="${k}"]`)?.value.trim() || "";
    const c = Object.fromEntries(CFIELDS.map(([k]) => [k, get(k)]));
    // The backend decides organisation vs person by whether a last name is
    // present, so the mode has to send one or the other and not both: an
    // organisation carrying a last name would be written as an individual.
    const mode = btn.dataset.blmMode || "auto";
    const asOrg = mode === "org" || (mode === "auto" && !!c.organization && !c.last_name);
    const who = asOrg ? c.organization : [c.first_name, c.last_name].filter(Boolean).join(" ");
    if (!who) {
      say("note-bad", asOrg ? "Enter an organisation name first." : "Enter a first and last name first.");
      return;
    }
    if (!confirm(`Create ${who} in Bloomerang as ${asOrg ? "an organisation" : "a person"}? `
      + `This adds a new constituent record and there is no undo.`)) return;
    btn.disabled = true;
    const label = btn.textContent; btn.textContent = "Creating…";
    try {
      const r = await blm("upsert_constituent", asOrg
        ? { organization: c.organization, email: c.email || undefined, phone: c.phone || undefined }
        : { first_name: c.first_name || undefined, last_name: c.last_name || undefined,
            email: c.email || undefined, phone: c.phone || undefined });
      say("note-ok", r.created
        ? `Created. Account #${r.account_number}. Now approve the note below.`
        : `Already on file as account #${r.account_number}. Now approve the note below.`);
      const field = card?.querySelector('[data-field="_accountNumber"]');
      if (field) field.value = r.account_number;
      btn.textContent = label;
    } catch (err) { say("note-bad", err.message); btn.disabled = false; btn.textContent = label; }
    return;
  }
  btn.disabled = true;
  try {
    if (btn.dataset.approve) {
      const acct = card.querySelector('[data-field="_accountNumber"]')?.value;
      const noteEl = card.querySelector("[data-blm-note]");
      const dateEl = card.querySelector("[data-blm-date]");
      // Whatever is in the gift boxes at the moment the button is pressed is
      // what gets recorded, not what the extractor first guessed.
      const gift = {};
      card.querySelectorAll("[data-gift]").forEach(el => {
        const v = el.value.trim();
        if (v !== "") gift[el.dataset.gift] = el.type === "number" ? Number(v) : v;
      });
      // A note with no body writes a blank record onto a donor, and the only
      // way back is a delete. Refuse it here rather than at the API.
      if (noteEl && !noteEl.value.trim()) {
        say("note-bad","Write the note first — an empty note cannot be sent.");
        btn.disabled = false; return;
      }
      // approve merges these over the stored payload, so what is on screen is
      // what goes to Bloomerang.
      const overrides = {};
      if (acct) overrides._accountNumber = Number(acct);
      if (noteEl) overrides.Note = noteEl.value.trim();
      if (dateEl?.value) overrides.Date = dateEl.value;
      // The gift fields are NOT sent as payload keys. bloomerang.pushOne strips
      // only _accountNumber and spreads the rest straight into the API call, so
      // any extra key would be posted to Bloomerang as a field on the note.
      // Instead her edits are folded into the note text, which is the one thing
      // this record type can actually carry.
      if (Object.keys(gift).length && noteEl) {
        const line = [
          gift.donor_organization || gift.donor_name,
          gift.amount != null ? money(gift.amount) : null,
          gift.gift_date ? "given " + gift.gift_date : null,
          gift.sponsor_level ? gift.sponsor_level + " level" : null,
          gift.designation ? "for " + gift.designation : null,
          gift.check_number ? "check " + gift.check_number : null,
        ].filter(Boolean).join(" \u00b7 ");
        if (line && !overrides.Note.includes(line)) overrides.Note = (overrides.Note + "\n\n" + line).trim();
      }
      await blm("approve", { id: btn.dataset.approve,
        ...(Object.keys(overrides).length ? { payload_overrides: overrides } : {}) });
      say("note-ok","Sent to Bloomerang."); card.classList.add("settled"); setTimeout(refresh, 800);
    } else if (btn.dataset.reject) {
      await blm("reject", { id: btn.dataset.reject, reason: prompt("Why reject this?") || "Not relevant" });
      card.classList.add("settled"); setTimeout(refresh, 500);
    } else if (btn.dataset.undo) {
      if (confirm("Delete this record from Bloomerang?")) { await blm("undo", { id: btn.dataset.undo }); await refresh(); }
      else btn.disabled = false;
    } else if (btn.dataset.guestYes) {
      await api("accept_guest", { id: btn.dataset.guestYes });
      say("note-ok","Added to the RSVP list."); card.classList.add("settled"); setTimeout(refresh, 700);
    } else if (btn.dataset.guestNo) {
      await api("reject_guest", { id: btn.dataset.guestNo });
      card.classList.add("settled"); setTimeout(refresh, 400);
    }
  } catch (err) { say("note-bad", err.message); btn.disabled = false; }
});

// ------------------------------------------------------- restore on refresh
// If a stored, unexpired token is present, confirm it with `me` and go straight
// to the app. A 401 means the server killed the session — clear it and show
// sign-in. Any other error leaves the token in place; refresh() surfaces it.
(async function restore() {
  const s = readSession();
  if (!s) return;
  TOKEN = s.token; USER = s.user;
  try {
    const r = await api("me");
    if (r && r.user) USER = r.user;
    enterApp();
    await refresh();
  } catch (err) {
    if (err.status === 401) { clearSession(); return; }
    // Server unreachable: keep the session and show the app so the user isn't
    // bounced to sign-in over a blip; refresh() reports the failure.
    enterApp();
    await refresh();
  }
})();
