const OPS = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/donor-ops";
const BLM = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/bloomerang";
const TSK = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/tasks";
const ASK = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/asks";
const DOC = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/docs";
let TOKEN = null, USER = null, D = null, TAB = "today";
// Today and Completed load from their own endpoint, so they keep their own
// state rather than hanging off the donor-ops dashboard payload.
let T = null, C = null, CFROM = null, CTO = null, A = null, F = null, DOCS = null;

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
  try {
    const r = await api("login", { email:$("email").value, password:$("password").value });
    saveSession(r);
    enterApp();
    await refresh();
  } catch (err) {
    $("signinMsg").innerHTML = `<div class="msg msg-bad">${esc(err.message)}</div>`;
    $("password").value = "";
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
  updateLede();
}));

const PANELS = ["today","questions","notes","bloomerang","records","asks","followups","docs","completed"];

async function refresh() {
  PANELS.forEach(p => $("panel-"+p).innerHTML = `<div class="loading">Loading…</div>`);
  loadToday();
  try { D = await api("dashboard"); render(); }
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
  ["cQ","cN","cB","cR"].forEach(id => $(id).textContent = "—");
  const detail = e && e.message ? e.message : "";
  const html = `<div class="empty">
      <b>The dashboard couldn't load.</b>
      <p>The server didn't answer. Try again in a moment.${detail ? `<br><span class="meta">${esc(detail)}</span>` : ""}</p>
      <div class="controls controls-center">
        <button class="btn btn-sm" data-retry="1">Try again</button>
      </div></div>`;
  // Today and Completed have their own endpoint and their own failure state;
  // a donor-ops outage should not blank a task list that loaded fine.
  ["questions","notes","bloomerang","records"].forEach(p => $("panel-"+p).innerHTML = html);
}

// The lede sits above every panel, so it has to describe whichever tab is
// open. Reading it from the donor-ops payload alone announced "Nothing is
// waiting on you." over a Today list with five open asks.
function updateLede() {
  const lede = $("lede"), sub = $("ledeSub");
  if (TAB === "today") {
    if (!T) { lede.textContent = "Loading…"; sub.textContent = ""; return; }
    const n = T.counts.open;
    lede.textContent = n === 0 ? "Nothing is waiting on you." :
      `${n} ${n === 1 ? "task" : "tasks"} open.`;
    sub.textContent = n === 0
      ? "No open asks from Debi."
      : (T.counts.over_7_days > 0
          ? `${T.counts.over_7_days} of them ${T.counts.over_7_days === 1 ? "has" : "have"} been open more than a week.`
          : "Oldest ask first.");
    return;
  }
  if (TAB === "asks") {
    if (!A) { lede.textContent = "Loading…"; sub.textContent = ""; return; }
    const n = A.counts.draft + A.counts.staged;
    lede.textContent = n === 0 ? "No answers drafted." : `${n} ${n === 1 ? "answer" : "answers"} drafted.`;
    sub.textContent = A.counts.flagged > 0
      ? `${A.counts.flagged} ${A.counts.flagged === 1 ? "has a flag" : "have flags"} to check before sending.`
      : "Approve the ones you are happy with, then create the draft.";
    return;
  }
  if (TAB === "followups") {
    const n = F ? (F.rows || []).filter(r => r.status === "draft").length : 0;
    lede.textContent = n === 0 ? "Nothing to chase." : `${n} ${n === 1 ? "chase" : "chases"} ready.`;
    sub.textContent = "Each one sends on its own approval.";
    return;
  }
  if (TAB === "docs") {
    if (!DOCS) { lede.textContent = "Loading…"; sub.textContent = ""; return; }
    const n = DOCS.counts.needs_human;
    lede.textContent = (DOCS.rows || []).length === 0 ? "No documents waiting."
      : `${DOCS.rows.length} ${DOCS.rows.length === 1 ? "document" : "documents"} back from Debi.`;
    sub.textContent = n === 0 ? "Nothing outstanding on them."
      : `${n} ${n === 1 ? "change needs" : "changes need"} your eye.`;
    return;
  }
  if (TAB === "completed") {
    const n = C ? (C.rows || []).length : 0;
    lede.textContent = n === 0 ? "Nothing completed in this range." : `${n} completed.`;
    sub.textContent = "Grouped by the day the box was ticked.";
    return;
  }
  if (!D) { lede.textContent = "Loading…"; sub.textContent = ""; return; }
  const q = D.counts.flags;
  lede.textContent = q === 0 ? "Nothing is waiting on you." :
    `${q} ${q === 1 ? "thing needs" : "things need"} an answer.`;
  sub.textContent = q === 0
    ? "Every gift on file has a donor, a designation and an amount."
    : "Each one is blocking a thank-you letter or a Bloomerang record.";
}

function render() {
  const q = D.counts.flags;
  updateLede();
  $("cQ").textContent = q;
  $("cN").textContent = D.counts.notes;
  $("cB").textContent = D.counts.bloomerang;
  $("cR").textContent = D.sponsors.length + D.rsvps.length + D.tuition.length + D.staging.length + D.auction.length;
  renderQuestions(); renderNotes(); renderBloomerang(); renderRecords();
}

// ------------------------------------------------------------- questions
const LEVELS = ["Event Sponsor","Champion","Hero","Leader","Partner","Advocate","Friend"];
const SRC = { sponsorships:"Sponsorship", tuition_payments:"Tuition", donations_staging:"Donation",
              thank_you_letters:"Letter", crm_inbox:"Email" };

function editor(f) {
  const id = esc(f.row_id);
  const types = (D.gift_types || []).map(t => `<option value="${t.code}">${esc(t.label)}</option>`).join("");
  if (f.kind === "sponsor_level_mismatch" || f.kind === "sponsor_missing_amount") {
    const s = D.sponsors.find(x => x.id === f.row_id) || {};
    return `<select class="field" data-field="level"><option value="">Level…</option>
      ${LEVELS.map(l => `<option ${s.level === l ? "selected":""}>${l}</option>`).join("")}</select>
      <input class="field" data-field="amount" type="number" step="0.01" placeholder="Amount" value="${s.amount ?? ""}">
      <button class="btn btn-go btn-sm" data-save="sponsorships:${id}">Save</button>`;
  }
  if (f.kind === "tuition_missing_participant")
    return `<input class="field wide" data-field="participant" placeholder="Participant name">
      <button class="btn btn-go btn-sm" data-save="tuition_payments:${id}">Save</button>`;
  if (f.kind === "donation_missing_donor")
    return `<input class="field wide" data-field="donor_name" placeholder="Donor name">
      <button class="btn btn-go btn-sm" data-save="donations_staging:${id}">Save</button>`;
  if (f.kind === "donation_uncategorised" || f.kind === "donation_parse_gap") {
    const d = D.staging.find(x => x.id === f.row_id) || {};
    return `<select class="field" data-field="gift_type"><option value="">What is it?…</option>${types}</select>
      <input class="field" data-field="amount" type="number" step="0.01" placeholder="Amount" value="${d.amount ?? ""}">
      <button class="btn btn-go btn-sm" data-save="donations_staging:${id}">Save</button>`;
  }
  if (f.kind === "check_email_review")
    return `<button class="btn btn-quiet btn-sm" data-note='${esc(JSON.stringify({label:f.who, body:"Re: "+(f.question||"")}))}'>Add a note</button>`;
  if (f.kind === "letter_incomplete") {
    const l = (D.letters || []).find(x => x.id === f.row_id) || {};
    // This flag is raised because the letter has no Drive file or no Gmail
    // draft on record, and neither is writable from here — both are written
    // when the letter is generated. The account number, category and notes
    // are writable, so offer those and say plainly that saving them records
    // what is known without clearing the flag.
    return `<input class="field med" data-field="constituent_account_number" type="number" placeholder="Account #" value="${esc(l.constituent_account_number ?? "")}">
      <input class="field" data-field="category" placeholder="Category" value="${esc(l.category ?? "")}">
      <input class="field wide" data-field="notes" placeholder="Note" value="${esc(l.notes ?? "")}">
      <button class="btn btn-go btn-sm" data-save="thank_you_letters:${id}">Save</button>
      <div class="meta meta-row">Saving records these against the letter. The missing file or draft is created when the letter itself is generated, so this flag stays until then.</div>`;
  }
  // Records is read-only, so telling anyone to fix it there was a dead end.
  return `<span class="meta">Nothing on this screen can resolve this one yet.</span>`;
}

function renderQuestions() {
  const items = (D.flags || []).map(f => ({ ...f, _d: daysSince(f.date) }))
    .sort((a,b) => (b._d ?? -1) - (a._d ?? -1));
  $("panel-questions").innerHTML = !items.length
    ? `<div class="empty"><b>Nothing is blocked.</b><p>Every gift on file has a donor, a designation and an amount.</p></div>`
    : items.map(f => `
      <div class="card" data-card="${esc(f.row_id)}">
        ${waitBlock(f._d)}
        <div>
          <div class="who-line">${esc(f.who || "(unnamed)")}</div>
          <div class="ask"><span class="tag">${SRC[f.table] || f.table}</span>${esc(f.question)}</div>
          ${f.detail ? `<div class="excerpt">${esc(f.detail)}</div>` : ""}
          <div class="controls">
            ${editor(f)}
            <div class="spacer"></div>
            ${f.link ? `<a class="btn btn-quiet btn-sm" href="${esc(f.link)}" target="_blank" rel="noopener">Open email</a>` : ""}
            <button class="btn btn-quiet btn-sm" data-dismiss='${esc(JSON.stringify({flag_kind:f.kind, table:f.table, row_id:f.row_id}))}'>Not relevant</button>
          </div>
          <div class="meta">${f.date ? "Received " + day(f.date) : "No date on the record"}${f.attachments ? ` · ${f.attachments} attachment${f.attachments===1?"":"s"}` : ""}</div>
          <div class="result"></div>
        </div>
      </div>`).join("");
}

// ----------------------------------------------------------------- notes
const TAGS = ["general","follow_up","question_for_kat","question_for_debi","bloomerang","gala","summit"];
function renderNotes() {
  const open = (D.notes||[]).filter(n => !n.resolved), done = (D.notes||[]).filter(n => n.resolved);
  $("panel-notes").innerHTML = `
    <div class="notebox">
      <label for="noteBody">Add a note</label>
      <textarea class="field" id="noteBody" placeholder="Something to chase, ask Kat, or remember from this sweep…"></textarea>
      <div class="controls">
        <select class="field" id="noteTag">${TAGS.map(t=>`<option value="${t}">${t.replace(/_/g," ")}</option>`).join("")}</select>
        <button class="btn btn-go btn-sm" id="noteAdd">Save note</button>
      </div>
      <div class="result" id="noteResult"></div>
    </div>
    ${open.length ? open.map(noteRow).join("") : `<div class="empty"><p>No open notes.</p></div>`}
    ${done.length ? `<div class="sec"><h2>Resolved</h2></div>${done.map(noteRow).join("")}` : ""}`;
}
const noteRow = n => `
  <div class="noterow ${n.resolved ? "done":""}">
    <p>${esc(n.body)}</p>
    <div class="meta"><span class="tag">${esc((n.tag||"general").replace(/_/g," "))}</span>${day(n.created_at)} · ${esc(n.created_by)}</div>
    <div class="controls note-controls">
      ${n.resolved ? `<button class="btn btn-quiet btn-sm" data-note-open="${n.id}">Reopen</button>`
                   : `<button class="btn btn-go btn-sm" data-note-done="${n.id}">Done</button>`}
      <button class="link" data-note-del="${n.id}">Delete</button>
    </div>
  </div>`;

// ------------------------------------------------------------ bloomerang
// A queued ask can carry a person or organisation that Debi wants to exist in
// Bloomerang. Creating one is a separate, explicit step from pushing the note:
// it uses the backend's own upsert_constituent, and only what the ask actually
// stated is offered — nothing here fills in a surname or an address.
function blmConstituent(i) {
  const c = i.extraction?.constituent;
  if (!c || i.match_constituent_id) return "";
  const who = c.organization || [c.first_name, c.last_name].filter(Boolean).join(" ");
  if (!who.trim()) return `<div class="note note-bad">Debi asked for someone to be added, but the
    email does not name them clearly enough to create a record. Open the thread and check.</div>`;
  const missing = !c.organization && !c.last_name ? " — no surname in the email" : "";
  return `<div class="note">
      <b>${esc(who)}</b>${esc(missing)}
      ${c.email ? ` · ${esc(c.email)}` : ""}${c.phone ? ` · ${esc(c.phone)}` : ""}
      <div class="controls note-controls">
        <button class="btn btn-quiet btn-sm" data-blm-new="${i.id}">Create this constituent</button>
        <span class="meta">Creates the record, then fills in the account number below.</span>
      </div>
    </div>`;
}

function renderBloomerang() {
  const rows = (D.inbox||[]).filter(i => ["needs_review","approved","failed","pushed"].includes(i.status));
  const pend = rows.filter(i => i.status !== "pushed");
  const guests = D.rsvp_candidates || [];
  $("panel-bloomerang").innerHTML = `
    ${guests.length ? `<div class="sec"><h2>Guests found in email</h2></div>` +
      guests.map(g => `<div class="card" data-card="${g.id}">${waitBlock(daysSince(g.received_at))}
        <div><div class="who-line">${esc([g.proposed?.title,g.proposed?.first_name,g.proposed?.last_name].filter(Boolean).join(" "))}</div>
        <div class="ask">Requested by ${esc(g.requested_by || "unknown")} — add as a comped guest?</div>
        ${g.raw_excerpt ? `<div class="excerpt">${esc(g.raw_excerpt)}</div>` : ""}
        <div class="controls">
          <button class="btn btn-go btn-sm" data-guest-yes="${g.id}">Add to RSVP list</button>
          <button class="btn btn-quiet btn-sm" data-guest-no="${g.id}">Not a guest</button>
          <div class="spacer"></div>
          ${g.gmail_permalink ? `<a class="btn btn-quiet btn-sm" href="${esc(g.gmail_permalink)}" target="_blank" rel="noopener">Open email</a>`:""}
        </div><div class="result"></div></div></div>`).join("") : ""}

    <div class="sec"><h2>Waiting to go to Bloomerang</h2></div>
    ${!pend.length ? `<div class="empty"><p>Nothing queued for Bloomerang.</p></div>` : pend.map(i => `
      <div class="card" data-card="${i.id}">${waitBlock(daysSince(i.received_at))}
        <div>
          <div class="who-line">${esc(i.from_name || i.from_email || "(unknown)")}</div>
          <div class="ask"><span class="tag">${esc(i.record_type || "note")}</span>${esc(i.subject || "(no subject)")}</div>
          ${i.extraction?.summary || i.raw_body ? `<div class="excerpt">${esc(i.extraction?.summary || (i.raw_body||"").slice(0,400))}</div>`:""}
          ${i.source === "ask" ? `<div class="task-meta">
            <span class="flag flag-ask">From Debi's ask</span>
            ${i.extraction?.kind === "constituent" ? `<span class="flag flag-warn">Wants a constituent added</span>` : ""}
          </div>` : ""}
          ${blmConstituent(i)}
          <div class="controls">
            ${i.match_constituent_id
              ? `<span class="state s-ok">Matched #${i.match_constituent_id}</span>`
              : `<span class="state s-bad">No constituent match</span>
                 <input class="field med" data-field="_accountNumber" type="number" placeholder="Account #">`}
            <button class="btn btn-go btn-sm" data-approve="${i.id}" ${i.status==="approved"?"disabled":""}>Approve &amp; push</button>
            <button class="btn btn-quiet btn-sm" data-reject="${i.id}">Reject</button>
            <div class="spacer"></div>
            ${i.gmail_permalink ? `<a class="btn btn-quiet btn-sm" href="${esc(i.gmail_permalink)}" target="_blank" rel="noopener">Open email</a>`:""}
          </div>
          ${i.push_error ? `<div class="note note-bad">${esc(i.push_error).slice(0,300)}</div>`:""}
          <div class="meta">${day(i.received_at)} · status ${esc(i.status)}</div>
          <div class="result"></div>
        </div></div>`).join("")}

    ${rows.filter(i=>i.status==="pushed").length ? `<div class="sec"><h2>Already in Bloomerang</h2></div>
      <div class="tablewrap"><table><thead><tr><th>Who</th><th>Type</th><th>Subject</th><th>Pushed</th><th></th></tr></thead><tbody>
      ${rows.filter(i=>i.status==="pushed").map(i=>`<tr>
        <td>${esc(i.from_name||i.from_email||"—")}</td><td>${esc(i.record_type||"note")}</td>
        <td>${esc(i.subject||"—")}</td><td class="num">${day(i.pushed_at)}</td>
        <td><button class="link" data-undo="${i.id}">Undo</button></td></tr>`).join("")}
      </tbody></table></div>`:""}`;
}

// --------------------------------------------------------------- records
// Donor names reach the two tables from different places and rarely match
// character for character: a trailing space, "Smith & Sons" against "Smith and
// Sons", a doubled space. Matching on a normalised key stops a letter that did
// go out from being reported as never sent. Apostrophes and full stops are
// dropped rather than turned into spaces, or "St. Mary's" keys as "st mary s"
// and stops matching "St Marys".
const nameKey = s => String(s ?? "").toLowerCase().replace(/&/g, " and ")
  .replace(/['’.]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const letterFor = name => {
  const k = nameKey(name); if (!k) return null;
  return (D.letters || []).find(x => nameKey(x.donor_display_name) === k) || null;
};

const SHEETS = () => [
  { key:"donations", title:"Donations",
    cols:["First Name","Last Name","Organization","Email","Donation Date","Donation Amount","Campaign","Gift Type","Thank You Note Sent?","Date Thank You Letter Sent to Debi"],
    rows:(D.staging||[]).map(d => {
      const org = (d.donor_organization || "").trim();
      // Split a name into first and last only when it is a person's. A gift
      // recorded against the organisation itself has no surname to find, and
      // splitting invented one — "The Smith Family Foundation" came out as
      // "The Smith Family" / "Foundation".
      const person = org && nameKey(org) === nameKey(d.donor_name) ? "" : (d.donor_name || "").trim();
      const p = person ? person.split(/\s+/) : [];
      const l = letterFor(d.donor_name);
      return [p.length > 1 ? p.slice(0,-1).join(" ") : person, p.length > 1 ? p.at(-1) : "", org,
        d.donor_email||"", (d.donation_date||"").slice(0,10), d.amount ?? "", d.category||"", d.gift_type||"",
        l ? (l.status==="unsent"?"No":"Yes") : "No", l?.sent_to_debi_at ? l.sent_to_debi_at.slice(0,10) : ""]; }) },
  { key:"sponsorships", title:"Sponsorships",
    cols:["First Name","Last Name","Organization","Address","Email","Phone Number","Sponsorship Date","Sponsorship Amount","Level","Campaign","Group","Contacted By","Thank You Note Sent?","Date Thank You Letter Sent to Debi"],
    rows:(D.sponsors||[]).map(s=>[s.first_name||"",s.last_name||"",s.organization||"",s.address||"",s.email||"",s.phone||"",
      s.sponsorship_date||"",s.amount??"",s.level||"",s.campaign||"",s.group_name||"",s.contacted_by||"",
      s.thank_you_sent?"Yes":"No",""]) },
  { key:"rsvps", title:"Gala RSVPs",
    cols:["Title","First Name","Last Name","Address","Email","Phone Number","VIP?","Guest?","Number of Tickets","Amount","Names of Guests"],
    rows:(D.rsvps||[]).map(r=>[r.title||"",r.first_name||"",r.last_name||"",r.address||"",r.email||"",r.phone||"",
      r.is_vip?"Yes":"No",r.is_guest?"Yes":"No",r.num_tickets??"",r.amount??"",r.guest_names||""]) },
  { key:"tuition", title:"Tuition Payments",
    cols:["First Name","Last Name","Participant","Payment Date","Amount","Check Number","Notes"],
    rows:(D.tuition||[]).map(t=>[t.first_name||"",t.last_name||"",t.participant||"",t.payment_date||"",t.amount??"",t.check_number||"",t.notes||""]) },
  { key:"auction", title:"Auction Item Donations",
    cols:["Donor Business","Contact Name","Email","Item Description","Market Value","Event"],
    rows:(D.auction||[]).map(a=>[a.donor_business||"",a.contact_name||"",a.email||"",a.item_description||"",a.market_value??"",a.event_name||""]) },
  { key:"outreach", title:"Sponsor Outreach",
    cols:["Name","Organization","Email","Type","Attempted","Outcome","Notes"],
    rows:(D.outreach||[]).map(o=>[o.donor_name||"",o.donor_organization||"",o.donor_email||"",o.attempt_type||"",
      (o.attempted_at||"").slice(0,10),o.outcome||"",o.notes||""]) },
];

function renderRecords() {
  $("panel-records").innerHTML = SHEETS().map(s => `
    <div class="sec"><h2>${s.title}</h2>
      <span class="pill pill-grey">${s.rows.length}</span>
      <div class="spacer"></div>
      <button class="btn btn-quiet btn-sm" data-csv="${s.key}">Download CSV</button></div>
    ${s.rows.length ? `<div class="tablewrap"><table><thead><tr>${s.cols.map(c=>`<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${s.rows.slice(0,200).map(r=>`<tr>${r.map((c,i)=>`<td class="${typeof c==="number"?"num":""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${s.rows.length>200?`<div class="meta">Showing the first 200. The CSV has all ${s.rows.length}.</div>`:""}`
    : `<div class="empty"><p>Nothing recorded yet.</p></div>`}`).join("");
}

function downloadCSV(key) {
  const s = SHEETS().find(x => x.key === key); if (!s) return;
  const q = v => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g,'""')}"` : t; };
  const csv = [s.cols.map(q).join(","), ...s.rows.map(r => r.map(q).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF"+csv], { type:"text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), {
    href:url, download:`SPARC ${s.title} ${new Date().toISOString().slice(0,10)}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}


// ------------------------------------------------------------------ Today
// What Debi has asked for, oldest ask first. Her numbered lists arrive as one
// row per number and keep her numbering, because she expects each answered
// separately.

const GMAIL_THREAD = id => "https://mail.google.com/mail/u/0/#all/" + encodeURIComponent(id);

async function loadToday() {
  try {
    T = await tsk("list"); renderToday();
    // Asks builds its "not drafted yet" list from T, so keep it in step when a
    // scan or a tick changes the task list underneath it.
    if (A) renderAsks();
    updateLede();
  }
  catch (e) {
    if (e.status === 401) return backToSignin("Your session has ended. Please sign in again.");
    $("cT").textContent = "—";
    $("panel-today").innerHTML = `<div class="empty">
      <b>The task list couldn't load.</b>
      <p>Nothing has been lost.${e.message ? `<br><span class="meta">${esc(e.message)}</span>` : ""}</p>
      <div class="controls controls-center"><button class="btn btn-sm" data-today-retry="1">Try again</button></div>
    </div>`;
  }
}

function taskRow(t) {
  const done = t.status === "done";
  const flags = [];
  // Asked more than once. Debi re-asks when something has gone quiet, so this
  // is the strongest signal on the row.
  if ((t.ask_count || 1) > 1) flags.push(`<span class="flag flag-ask">Asked ×${t.ask_count}</span>`);
  if (!done && t.days_open > 7) flags.push(`<span class="flag flag-old">${t.days_open} days</span>`);
  if (t.due_at) flags.push(`<span class="flag flag-due">Due ${day(t.due_at)}</span>`);

  const who = t.requested_by === "debi@sparcsolutions.org" ? "Debi" : esc(t.requested_by);
  const idx = t.list_index ? `<span class="idx">#${esc(t.list_index)}</span>` : "";

  return `<div class="task${done ? " done" : ""}" data-task="${t.id}">
    <input class="task-check" type="checkbox" ${done ? "checked" : ""}
           data-check="${t.id}" aria-label="Mark done: ${esc(t.title)}">
    <div>
      <div class="task-title">${esc(t.title)}</div>
      <div class="task-meta">
        ${idx}<span>${who}</span><span>${day(t.requested_at)}</span>
        ${flags.join("")}
        ${t.source_quote ? `<button class="quote-toggle" data-quote="${t.id}">Her words</button>` : ""}
        ${t.source_thread_id ? `<a href="${esc(GMAIL_THREAD(t.source_thread_id))}" target="_blank" rel="noopener">Open thread</a>` : ""}
      </div>
      ${t.detail ? `<div class="task-detail">${esc(t.detail)}</div>` : ""}
      ${t.source_quote ? `<div class="task-quote hidden" id="q${t.id}">“${esc(t.source_quote)}”</div>` : ""}
    </div>
    <div class="task-side">
      <button class="task-x" data-del="${t.id}"
              title="Delete — will not appear in Completed" aria-label="Delete task">×</button>
    </div>
  </div>`;
}

function renderToday() {
  const c = T.counts;
  $("cT").textContent = c.open;

  const when = T.last_scan_at
    ? `Last scan ${day(T.last_scan_at)}, ${new Date(T.last_scan_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : "No scan has run yet";

  const rows = T.tasks.length
    ? T.tasks.map(taskRow).join("")
    : `<div class="empty"><b>Nothing is waiting on you.</b>
         <p>No open asks from Debi. The next scan runs at 8am, noon and 5pm.</p></div>`;

  $("panel-today").innerHTML = `
    <div class="scanbar">
      <h2>${esc(day(T.today))}</h2>
      <span class="meta">${esc(when)}${T.last_scan_error ? " · last scan reported a problem" : ""}</span>
    </div>
    ${T.last_scan_error ? `<div class="note note-bad">Last scan: ${esc(String(T.last_scan_error).slice(0, 300))}</div>` : ""}
    <div class="tiles">
      <div class="tile"><b>${c.open}</b><span>Open</span></div>
      <div class="tile tile-green"><b>${c.done_today}</b><span>Done today</span></div>
      <div class="tile tile-red"><b>${c.over_7_days}</b><span>Over 7 days</span></div>
      <div class="tile tile-amber"><b>${c.asked_twice}</b><span>Asked twice</span></div>
    </div>
    <div class="controls">
      <button class="btn btn-quiet btn-sm" data-tcsv="day">Download today</button>
      <button class="btn btn-quiet btn-sm" data-tcsv="week">Download week</button>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-scan="1">Scan now</button>
    </div>
    <div class="result note-controls"></div>
    ${rows}`;
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


// ------------------------------------------------------------------- Asks
// One answer draft per ask from Debi. The flags are the point of this panel:
// the generator grades its own output and says what it could not source, and
// a bracketed placeholder means a human still has to fill a gap. Nothing here
// sends — approved answers assemble into one Gmail draft in Debi's numbering.

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
  // it is loaded first. loadToday() swallows its own failure and leaves T null,
  // which renderAsks() falls back from.
  try { if (!T) await loadToday(); } catch {}
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
          <button class="quote-toggle" data-ask-blm="${t.id}">Add to Bloomerang</button>
          <button class="quote-toggle" data-ask-dismiss="${t.id}">Not answering this</button>
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
  const rows = F.rows || [];
  $("cF").textContent = rows.filter(r => r.status === "draft").length;

  // Only tasks whose wording actually asks Erica to chase a named person are
  // candidates; the generator decides, and says no when nobody is named.
  const candidates = (T?.tasks || []).filter(t =>
    t.status === "open" && /follow up|check with|chase|reach out|circle back|touch base/i.test(t.title + " " + (t.detail || "")))
    .filter(t => !rows.some(r => r.task_id === t.id));

  $("panel-followups").innerHTML = `
    <div class="result note-controls" id="fuResult"></div>
    ${rows.length ? rows.map(followupCard).join("") : `<div class="empty">
      <b>Nothing to chase.</b><p>Draft one from a task below that asks you to follow up with someone.</p></div>`}
    ${candidates.length ? `<h2 class="sec">Tasks that look like a follow up</h2>
      ${candidates.slice(0, 25).map(t => `<div class="task"><span></span><div>
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta"><span>${day(t.requested_at)}</span>
          <button class="quote-toggle" data-fu-gen="${t.id}">Draft a chase</button></div>
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
    ${d.tracked_change_count
      ? `<div class="controls"><button class="btn btn-quiet btn-sm" data-doc-diff="${d.id}">Show her changes side by side</button></div>`
      : ""}
    <div class="diffwrap hidden" id="dw${d.id}"></div>
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
  const t = e.target.closest("[data-save],[data-dismiss],[data-restore],[data-csv],[data-retry],[data-ask-dismiss],[data-ask-restore],[data-ask-blm],[data-blm-new],[data-note-done],[data-note-open],[data-note-del],[data-approve],[data-reject],[data-undo],[data-guest-yes],[data-guest-no],[data-note],[data-check],[data-del],[data-quote],[data-scan],[data-tcsv],[data-crange],[data-today-retry],[data-asks-retry],[data-asks-draft],[data-answer-edit],[data-answer-save],[data-answer-regen],[data-answer-approve],[data-answer-unstage],[data-answer-dismiss],[data-fu-gen],[data-fu-firmer],[data-fu-save],[data-fu-send],[data-fu-dismiss],[data-fu-answered],[data-docs-retry],[data-docs-scan],[data-doc-diff],[data-doc-mark],[data-instr]");
  if (!t && e.target.id !== "noteAdd") return;
  const btn = t || $("noteAdd");

  // ---- Today and Completed. Handled before the donor-ops branches because
  // these read from their own endpoint and their own state.
  if (btn.dataset.todayRetry) return loadToday();
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
  if (btn.dataset.check) {
    const id = btn.dataset.check;
    const row = btn.closest(".task");
    // Toggle the row immediately; the box is already visually checked and
    // waiting for a round trip makes it feel broken.
    row?.classList.toggle("done", btn.checked);
    try { await tsk("check", { id: Number(id), checked: btn.checked }); await loadToday(); }
    catch (err) { row?.classList.toggle("done", !btn.checked); btn.checked = !btn.checked; alert(err.message); }
    return;
  }
  if (btn.dataset.del) {
    const row = btn.closest(".task");
    if (!confirm("Delete this task? It will not appear in Completed.")) return;
    btn.disabled = true;
    try {
      await tsk("delete", { id: Number(btn.dataset.del) });
      row?.classList.add("going");
      setTimeout(loadToday, 220);
    } catch (err) { btn.disabled = false; alert(err.message); }
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
  if (btn.dataset.docMark) {
    const [id, status] = btn.dataset.docMark.split(":");
    if (status === "dismissed" && !confirm("Dismiss this document?")) return;
    btn.disabled = true;
    try { await doc("mark", { id: Number(id), status }); await loadDocs(); }
    catch (err) { alert(err.message); btn.disabled = false; }
    return;
  }

  // ---- Asks
  if (btn.dataset.asksRetry) return loadAsks();
  // Set an ask aside, or put it back. Neither touches the Today list.
  for (const [key, action] of [["askDismiss", "dismiss_task"], ["askRestore", "restore_task"]]) {
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

  if (btn.dataset.scan) {
    btn.disabled = true; const label = btn.textContent; btn.textContent = "Scanning…";
    const out = $("panel-today").querySelector(".result");
    try {
      const r = await tsk("scan", { max_extractions: 12 });
      if (out) out.innerHTML = `<div class="note ${r.error ? "note-bad" : "note-ok"}">${
        esc(r.error ? "Scan failed: " + r.error
          : `${r.messages_seen} messages read, ${r.tasks_created} new, ${r.duplicates_matched} already on the list.`
            + (r.complete ? "" : " More to read — run it again."))}</div>`;
      await loadToday();
    } catch (err) { if (out) out.innerHTML = `<div class="note note-bad">${esc(err.message)}</div>`; }
    btn.disabled = false; btn.textContent = label;
    return;
  }

  const card = btn.closest(".card") || btn.closest(".notebox");
  const out = card?.querySelector(".result");
  const say = (c, m) => { if (out) out.innerHTML = `<div class="note ${c}">${esc(m)}</div>`; };
  if (btn.dataset.csv) return downloadCSV(btn.dataset.csv);
  if (btn.dataset.retry) return refresh();
  // Create the constituent an ask asked for, using only the fields the email
  // stated. Confirmed by name first: this writes a new record into live donor
  // data and there is no undo for a constituent.
  if (btn.dataset.blmNew) {
    const row = (D.inbox || []).find(x => x.id === btn.dataset.blmNew);
    const c = row?.extraction?.constituent;
    if (!c) return;
    const who = c.organization || [c.first_name, c.last_name].filter(Boolean).join(" ");
    if (!confirm(`Create ${who} in Bloomerang? This adds a new constituent record.`)) return;
    btn.disabled = true;
    const label = btn.textContent; btn.textContent = "Creating…";
    try {
      const r = await blm("upsert_constituent", {
        first_name: c.first_name || undefined, last_name: c.last_name || undefined,
        organization: c.organization || undefined,
        email: c.email || undefined, phone: c.phone || undefined,
      });
      say("note-ok", r.created
        ? `Created. Account #${r.account_number}. Now approve the note below.`
        : `Already on file as account #${r.account_number}. Now approve the note below.`);
      const field = card?.querySelector('[data-field="_accountNumber"]');
      if (field) field.value = r.account_number;
      btn.textContent = label;
    } catch (err) { say("note-bad", err.message); btn.disabled = false; btn.textContent = label; }
    return;
  }
  if (btn.dataset.restore) {
    btn.disabled = true;
    try { await api("restore_dismissed", JSON.parse(btn.dataset.restore)); await refresh(); }
    catch (err) { btn.disabled = false; if (out) say("note-bad", err.message); else alert(err.message); }
    return;
  }

  btn.disabled = true;
  try {
    if (btn.dataset.save) {
      const [table, id] = btn.dataset.save.split(":");
      const fields = {};
      card.querySelectorAll("[data-field]").forEach(el => {
        const name = el.dataset.field;
        if (name.startsWith("_")) return;           // UI-only, never written back
        // A field that arrived with a value and is now empty was cleared on
        // purpose; one that was empty all along was simply not filled in. Only
        // the first is sent, and the backend reads "" as null — so a wrong
        // value can finally be removed rather than only overwritten.
        const had = el.tagName === "SELECT"
          ? (el.querySelector("option[selected]")?.value ?? "")
          : el.defaultValue;
        if (el.value !== "" || had !== "") fields[name] = el.value;
      });
      if (!Object.keys(fields).length) { say("note-bad","Fill in a value first."); btn.disabled = false; return; }
      await api("update", { table, id, fields });
      say("note-ok","Saved."); card.classList.add("settled"); setTimeout(refresh, 650);
    } else if (btn.dataset.dismiss) {
      const payload = JSON.parse(btn.dataset.dismiss);
      await api("dismiss", payload);
      // Dim the card and leave it in place rather than refreshing it away, so
      // a mis-click can be taken back. It clears on the next refresh like any
      // other card that has been dealt with.
      card.classList.add("settled");
      if (out) out.innerHTML = `<div class="note note-ok">Dismissed. `
        + `<button class="link" data-restore='${esc(JSON.stringify(payload))}'>Undo</button></div>`;
      // Drop the flag from the payload held in memory and redraw only the
      // counts, so the tab pill and the lede stay honest without re-rendering
      // the panel out from under the undo. Undo calls refresh() and reloads
      // the real numbers.
      D.flags = (D.flags || []).filter(x =>
        !(x.kind === payload.flag_kind && x.table === payload.table && x.row_id === payload.row_id));
      D.counts.flags = D.flags.length;
      $("cQ").textContent = D.counts.flags;
      updateLede();
    } else if (e.target.id === "noteAdd") {
      await api("note", { body: $("noteBody").value, tag: $("noteTag").value });
      $("noteBody").value = ""; await refresh();
    } else if (btn.dataset.note) {
      const n = JSON.parse(btn.dataset.note);
      await api("note", { body: n.body, tag: "follow_up", subject_label: n.label });
      say("note-ok","Note added."); setTimeout(refresh, 500);
    } else if (btn.dataset.noteDone)  { await api("note", { id: btn.dataset.noteDone, resolved: true }); await refresh(); }
      else if (btn.dataset.noteOpen)  { await api("note", { id: btn.dataset.noteOpen, resolved: false }); await refresh(); }
      else if (btn.dataset.noteDel)   { await api("note_delete", { id: btn.dataset.noteDel }); await refresh(); }
      else if (btn.dataset.approve) {
      const acct = card.querySelector('[data-field="_accountNumber"]')?.value;
      await blm("approve", { id: btn.dataset.approve, ...(acct ? { payload_overrides:{ _accountNumber:Number(acct) } } : {}) });
      say("note-ok","Pushed to Bloomerang."); card.classList.add("settled"); setTimeout(refresh, 800);
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
