const OPS = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/donor-ops";
const BLM = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/bloomerang";
const TSK = "https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/tasks";
let TOKEN = null, USER = null, D = null, TAB = "today";
// Today and Completed load from their own endpoint, so they keep their own
// state rather than hanging off the donor-ops dashboard payload.
let T = null, C = null, CFROM = null, CTO = null;

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

const money = n => n == null ? "—" : "$" + Number(n).toLocaleString("en-US",
  { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const day = d => d ? new Date(d).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : "—";
const daysSince = d => d == null ? null : Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));

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
  updateLede();
}));

const PANELS = ["today","questions","notes","bloomerang","records","completed"];

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
  return `<span class="meta">Open the record under Records to fix this.</span>`;
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
const SHEETS = () => [
  { key:"donations", title:"Donations",
    cols:["First Name","Last Name","Address","Email","Phone Number","Donation Date","Donation Amount","Campaign","Gift Type","Thank You Note Sent?","Date Thank You Letter Sent to Debi"],
    rows:(D.staging||[]).map(d => {
      const p=(d.donor_name||"").trim().split(/\s+/);
      const l=(D.letters||[]).find(x=>x.donor_display_name===d.donor_name);
      return [p.slice(0,-1).join(" ")||d.donor_name||"", p.length>1?p.at(-1):"", "", d.donor_email||"", "",
        (d.donation_date||"").slice(0,10), d.amount ?? "", d.category||"", d.gift_type||"",
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
  try { T = await tsk("list"); renderToday(); updateLede(); }
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

// --------------------------------------------------------------- actions
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-save],[data-dismiss],[data-csv],[data-retry],[data-note-done],[data-note-open],[data-note-del],[data-approve],[data-reject],[data-undo],[data-guest-yes],[data-guest-no],[data-note],[data-check],[data-del],[data-quote],[data-scan],[data-tcsv],[data-crange],[data-today-retry]");
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

  btn.disabled = true;
  try {
    if (btn.dataset.save) {
      const [table, id] = btn.dataset.save.split(":");
      const fields = {};
      card.querySelectorAll("[data-field]").forEach(el => { if (el.value !== "" && !el.dataset.field.startsWith("_")) fields[el.dataset.field] = el.value; });
      if (!Object.keys(fields).length) { say("note-bad","Fill in a value first."); btn.disabled = false; return; }
      await api("update", { table, id, fields });
      say("note-ok","Saved."); card.classList.add("settled"); setTimeout(refresh, 650);
    } else if (btn.dataset.dismiss) {
      await api("dismiss", JSON.parse(btn.dataset.dismiss));
      card.classList.add("settled"); setTimeout(refresh, 400);
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
