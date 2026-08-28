# Backend reference

The backend is Supabase Edge Functions on project ref `ldxpockcgcxvsrbyhcnt`.
It is already deployed and live. This repo holds only the frontend; the
function source lives in Supabase.

Base URL: `https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/<slug>`

## Functions in use by this dashboard

| Slug | Purpose |
| --- | --- |
| `donor-ops` | Auth, dashboard payload, row edits, notes, guest review |
| `bloomerang` | Approve / reject / undo pushes of inbox records into Bloomerang |
| `tasks` | The Today and Completed panels — what Debi has asked for, and the Gmail scan that finds it |
| `asks` | The Asks and Follow ups panels — answer drafts for Debi, chase emails for other people |
| `docs` | The Needs editing panel — documents Debi sends back, her tracked changes and her instructions |
| `daily-sweep` | Nightly Gmail scan that populates the staging tables |
| `letters` | Thank-you letter generation and Drive/Gmail draft tracking |
| `gmail-auth` | OAuth handshake for the sweep's Gmail access |
| `constituent-notes` | Notes written back to constituent records |
| `donations-view` | Read-only donation views |
| `bloomerang-ack` | Acknowledgement writeback |
| `bloomerang-attach` | Attaches letters and documents to Bloomerang records |
| `gala-outreach` | Sponsor outreach tracking — **queue retired 26 Aug 2026**, see below |
| `bloomerang-snapshot` | Refreshes the local mirror of Bloomerang transactions |
| `gift-scan` | Finds donations, sponsorships and grants in Erica's mail |

Three older functions on the same project (`virtual-summit-register`,
`volunteer-register`, `photo-gallery`) belong to the public SPARC website, not
to this app. Leave them alone.

## Calling convention

Every request is a `POST` with a JSON body of `{ action, ...params }`.
Authenticated calls carry `Authorization: Bearer <token>`, where the token came
from the `login` action. CORS is open (`*`), so any origin works — including
`localhost` while developing.

`tasks`, `asks` and `docs` share one session contract with `donor-ops`: the same
`app_sessions` row, the same 8-hour expiry, the same `401 { error }` when it has
gone. They also accept the service role key as a bearer token and record the
caller as `system:cron`, which is how the scheduled scans authenticate. Unknown
actions on those three return `400` with `{ error, valid_actions }`.

## `donor-ops` actions

| Action | Auth | Notes |
| --- | --- | --- |
| `login` | no | `{ email, password }` → `{ token, expires_at, user }`. Session lasts 8 hours. |
| `logout` | token | Deletes the session row. |
| `me` | yes | Returns the signed-in user. |
| `dashboard` | yes | The whole payload: `flags`, `letters`, `sponsors`, `tuition`, `staging`, `rsvps`, `notes`, `inbox`, `gift_types`, `rsvp_candidates`, `auction`, `outreach`, `counts`. |
| `update` | yes | `{ table, id, fields }`. Only whitelisted columns are writable — see below. |
| `dismiss` | yes | Hides a flag: `{ flag_kind, table, row_id, reason? }`. |
| `restore_dismissed` | yes | Undoes a dismissal. |
| `note` | yes | Create (`{ body, tag }`) or update (`{ id, resolved }`) a sweep note. |
| `note_delete` | yes | `{ id }`. |
| `accept_guest` | yes | Turns an `rsvp_candidates` row into a real comped RSVP. |
| `reject_guest` | yes | Marks a candidate rejected. |
| `change_password` | yes | `{ current_password, new_password }`. Minimum 12 characters. |

Unknown actions return `400` with `{ error }`. Every response is JSON; the
frontend's `call()` helper throws on non-2xx using `out.error`.

## Editable columns

`update` silently drops anything not on this list:

- **sponsorships** — first_name, last_name, organization, email, phone, address,
  amount, level, campaign, group_name, contacted_by, sponsorship_date,
  invoice_number, notes, gift_type
- **tuition_payments** — first_name, last_name, participant, payment_date,
  amount, check_number, notes
- **donations_staging** — donor_name, donor_organization, donor_email, amount,
  donation_date, category, gift_type, sub_category, event_name, status
- **rsvps** — title, first_name, last_name, email, phone, is_vip, vip_reason,
  is_guest, num_tickets, amount, guest_names, notes, gift_type, invited_by
- **thank_you_letters** — notes, category, constituent_account_number
- **crm_inbox** — review_notes

Setting `gift_type` also syncs `category` from the `gift_types` table, so the
right letter template gets used downstream. Sponsorship rows with
`logo_locked = true` reject logo overwrites with a `409`.

An empty string clears a column: `update` writes `""` as `null`. That is the
only way to remove a value, so the UI must distinguish a field left blank from
one emptied on purpose and send `""` only for the second.

## Flags the dashboard raises

`sponsor_level_mismatch`, `sponsor_missing_amount`,
`tuition_missing_participant`, `donation_missing_donor`,
`donation_uncategorised`, `donation_parse_gap`, `check_email_review`,
`letter_incomplete`.

Sponsorship tiers used for the mismatch check: Event Sponsor 25,000;
Champion 10,000; Hero 7,500; Leader 5,000; Partner 2,500; Advocate 1,000;
Friend 500.

`letter_incomplete` is raised for a `thank_you_letters` row with no
`drive_file_id` or no `gmail_draft_id`. Neither column is on the editable list,
and the `letters` function writes a different table (`letter_drafts`), so
**nothing in the dashboard can currently clear this flag.** The UI says so on
the card rather than offering an editor that would not resolve it. Closing the
gap means either pointing the flag at `letter_drafts` or having `letters` write
back to `thank_you_letters`; both are backend changes.

## `tasks` actions

The Today and Completed panels. Debi's numbered asks arrive as one row per
number and keep her numbering in `list_index`; a re-ask increments `ask_count`
on the existing row instead of inserting a duplicate.

| Action | Notes |
| --- | --- |
| `list` | Open tasks plus any ticked today that the 17:00 sweep has not archived. Returns `{ today, last_scan_at, last_scan_error, counts, tasks }`. `counts` is `{ open, done_today, over_7_days, asked_twice }`; each task carries `days_open`. |
| `check` | `{ id, checked }`. Unchecking also removes the archive row, so a task cannot read as open and completed at once. |
| `delete` | `{ id }`. Soft delete — `status` becomes `deleted` and the task never appears in Completed. |
| `add` | `{ title, detail?, due_at? }`. A hand-added task has `source: "manual"` and no thread behind it. |
| `update` | `{ id, fields }`. Only `title`, `detail` and `due_at` are writable; the lifecycle owns everything else. |
| `completed` | `{ from, to }` as `YYYY-MM-DD` → `{ rows }` from `tasks_completed`, capped at 2000. |
| `export` | `{ scope: "day" \| "week", date }` → `{ scope, from, to, rows }`. Returns rows; the client builds the CSV. |
| `scan` | `{ since?, max_extractions? }`. Reads Debi's mail and extracts asks. Defaults to the last two days so a missed run self-heals, and to 12 extractions. |
| `backfill` | `{ from, to, max_extractions? }`. Same scan over an explicit window; both dates required. |

`scan` and `backfill` are **resumable by design**. Extraction is one Anthropic
call per message and a long sequence of them hits `WORKER_RESOURCE_LIMIT`, so
each invocation spends at most `max_extractions` and reports `extractions_left`
and `complete: false` when there is more to read. A month-long backfill is many
cheap passes, not one that dies at 80%.

Extraction is a model call and only a model call. A message the model cannot
return JSON for is recorded on `task_scan_messages` and skipped — there is no
regex fallback, deliberately: the pre-2026-08-15 pipeline had one and it read
email signatures as donor names. Every run writes a `task_scan_runs` row,
success or failure, and `list` surfaces the last one as `last_scan_error`.

Dates are resolved in `America/New_York`, not UTC: `today`, `completed_on` and
`due_at` are all calendar dates in Erica's day. They come back as bare
`YYYY-MM-DD` strings, which JavaScript's `Date` parses as midnight UTC — see
`asDate()` in `app.js`, which exists for exactly this.

## `asks` actions

Answer drafts for Debi's asks, and chase emails to the people behind them. Both
live in one function because they share the session, the Gmail token and the
model call.

The verification gate is the point of this function. The generator grades its
own output and returns what it could not stand behind: `unsourced_claim`,
`missing_interpretation`, `filler`, `repeat_ask`. Where a fact cannot be sourced
from the thread the draft writes a `[bracketed placeholder]` rather than
inventing a name, figure or date — and a placeholder left in the text is
treated as an unsourced claim whether or not the model flagged it.

| Action | Notes |
| --- | --- |
| `list` | `{ answers, pending, pending_total, parked, counts }`. `pending` is open, un-parked tasks with no answer yet — **the oldest 100 of them**, so it cannot answer "most recent first" on its own; the UI builds that list from `tasks/list` instead. `parked` is what has been set aside or sent to Bloomerang. |
| `generate` | `{ task_id }`. Drafts one answer. `422` when the task was added by hand or its Gmail thread cannot be read — with nothing to source from, refusing is the feature. Clears `ask_state`, so drafting an answer un-parks the ask. |
| `dismiss_task` | `{ task_id }`. Erica is not answering this one. Sets `tasks.ask_state = 'dismissed'`. **The task stays open on Today** — this only stops Asks offering it. |
| `restore_task` | `{ task_id }`. Clears `ask_state`. |
| `to_bloomerang` | `{ task_id }`. Classifies the ask and, if it is a CRM request, stages a `crm_inbox` row for it. Returns `{ is_bloomerang: false, reason }` when it is not — the bar is deliberately high, because a false positive routes a real question away from the panel where it would have been answered. Nothing is posted to Bloomerang. |
| `save` | `{ id, edited_draft }`. |
| `approve` | `{ id }` → `staged`. `409` if it is not a draft any more. |
| `unstage` | `{ id }` → back to `draft`. |
| `dismiss` | `{ id }`. |
| `create_draft` | Assembles every staged answer into **one Gmail draft** to Debi, in her numbering. Never sends. Returns `{ gmail_draft_id, answers, gmail_url, note }`. |
| `followups` | `{ rows }`, each with its task and `days_open`. |
| `followup_generate` | `{ task_id, tone? }` where tone is `normal` or `firmer`. Returns `{ is_followup: false, reason }` when the task names nobody to chase. |
| `followup_save` | `{ id, edited_draft?, subject?, target_email? }`. A malformed address is rejected with `400`. |
| `followup_send` | `{ id }`. Sends one email. `422` with no recipient, and `422` if a `[placeholder]` is still in the body. |
| `followup_answered` / `followup_dismiss` | `{ id }`. |

## `asks-autodraft` actions

Erica, 27 Aug 2026: *"I don't want to hit draft an answer anywhere, I want the suggested
answer already drafted. I will edit then send."* So the Asks panel should have a draft
waiting rather than a button. Deployed 28 Aug 2026.

| Action | Notes |
| --- | --- |
| `run` (default) | `{ limit? }` (default 10, hard cap 15). Drafts the **newest** un-drafted open asks by calling `asks.generate` once per task. Returns `{ counts: { drafted, refused, failed }, drafted, refused, failed, remaining, complete, stopped_early, elapsed_ms }`. |
| `preview` | `{ limit? }`. What it *would* draft, and `without_a_draft` — the honest backlog count. Read-only: **spends no model call**, so use it before changing the limit. |

### Why it is a separate function, not an action on `asks`

Every draft is one Anthropic call plus a Gmail thread fetch, and a long sequence of them
inside one worker hits `WORKER_RESOURCE_LIMIT` — the same reason `tasks.scan` is resumable.
Calling `asks.generate` over **HTTP** gives each draft its own worker invocation with its
own limit; this function only waits on the network. It also means a bug here cannot break
the answer generator itself.

### What it will not do

It does not clear the backlog, and does not pretend to. There were **398** open asks
without a draft on 28 Aug; drafting all of them is 398 model calls. It spends at most
`limit` per run and reports `remaining` honestly, so three runs a day keep the front of
the queue warm. Erica chose that scope: *"Newest 10 on each scan."*

It never drafts for a hand-added task or one whose Gmail thread cannot be read —
`asks.generate` refuses those with `422` because there is nothing to source an answer
from, and refusing is the feature. Those are filtered out before the budget is spent and
counted as `refused`, separately from real `failed`.

Nothing is sent, and nothing reaches `staged`. Drafts land at `status = 'draft'` for Erica
to edit, exactly as if she had clicked the button.

**A draft may contain a `[bracketed placeholder]`, and that is correct** — the generator
writes one wherever a fact cannot be sourced from the thread, rather than inventing it,
and flags the draft `unsourced_claim`. On 28 Aug task 420 ("background context for the
$100 before Debi can sign letters") drafted as *"I do not have the background on the $100
in this thread… [description of what the $100 represents]"* — the honest answer. That is
the opposite of the letters path, where `letters.return_document` **422s** on a leftover
placeholder: a letter goes to a donor, an answer goes to Erica to finish.

Regenerating replaces rather than stacks: there is one live answer per task.
Nothing here sends anything to Debi, and follow-ups send one at a time on their
own approval — there is no bulk send anywhere in this function.

### Asks that are not answered in prose

`tasks.ask_state` is null, `'dismissed'` or `'bloomerang'`. It controls only
whether the Asks panel offers to answer a task; it never changes `status`, so a
parked ask is still open on Today and still counts there. `dismiss` (on an
answer) parks its task too — before, dismissing a draft put the task straight
back into "not drafted yet", because the answered set is built from
non-dismissed answers only.

`to_bloomerang` writes the drafted row with **`record_type: 'note'`** and a
`proposed_payload` of exactly `{ _accountNumber, Date, Note }`. That shape is
load-bearing: `bloomerang.pushOne` strips `_accountNumber` and spreads the rest
straight into the API call, so any extra key would be sent to Bloomerang as a
field on the note, and a `record_type` outside note / interaction / task has no
endpoint at all. Everything else the draft knows — the constituent it wants
created, the originating task — goes in `extraction`, which the pusher ignores.

`dedupe_key` is `ask:<task_id>`, so re-running is a no-op rather than a second
queue entry. `source` is **`debi_request`** — `crm_inbox_source_check` permits
only `scan`, `debi_cc`, `donation`, `debi_request`, `general` and `backfill`, so
anything else fails the insert. Rows that came from an ask are identified by
`extraction.from_task_id`, not by `source`. The constituent lookup is read-only (`crm_sender_map`, then
`crm_account_map`) and makes no Bloomerang API call; a miss leaves
`_accountNumber` null and the Bloomerang panel asks for it, exactly as it does
for a swept email that did not match.

## `docs` actions

The documents Debi sends back for editing. Two kinds arrive together: tracked
changes inside a `.docx`, and the instructions she writes in the covering email,
which for decks is the more common case.

| Action | Notes |
| --- | --- |
| `list` | `{ rows, counts }` where counts is `{ pending, needs_human, tracked }`. Each row carries its archived `attachment` with a `drive_url`. |
| `scan` | `{ days?, max_messages? }` — defaults 30 and 15. Finds Debi's mail with `.docx`, `.pptx` or `.xlsx` attached, archives each to Drive, and extracts the instructions. A message already queued costs no model call. |
| `diff` | `{ id }` → `{ paragraphs, insertions, deletions, comments, original, revised }`. `422` for anything that is not a `.docx`. |
| `instructions_save` | `{ id, instructions }` — the **whole** list. It is one `jsonb` column, so a partial write drops the others. `state` must be `needs_human`, `done` or `skipped`. |
| `revise` | `{ id, force? }` → `{ revision }` with `revised_text`, `applied[]` and `not_applied[]`. Starts from the mechanically-applied tracked changes and additionally acts on her margin comments and the email instructions. Cached: a second call returns the stored revision unless `force` is set, because a rewrite is a model call over a whole document. `422` when she left nothing to apply, and for anything that is not a `.docx`. |
| `mark` | `{ id, status }` — `pending`, `revised`, `returned` or `dismissed`. Bookkeeping only: **it emails nothing and sends no file.** `returned` sets the status and stamps `returned_at`. |

Reconstructing both sides of a diff is a read of the file, not a guess at
intent: `<w:del>` runs are her original, `<w:ins>` runs are the text with her
changes applied.

**Nothing here rewrites the FILE.** `revise` produces revised *text* in
`doc_revisions.revision`; it does not edit the `.docx` in place and cannot touch
an image, a slide, a chart or page layout. Anything asking for those comes back
under `not_applied` with that as the reason. The email instructions stay
`needs_human` until a person ticks them. Do not add a code path that reports a
change as applied when it has not been.

`revise` is wired to the "Make her edits" button in the Needs editing panel as
at 27 Aug 2026. The panel shows what was applied, what was not and why, and the
text open for editing; **`letters.return_document`** then turns the edited text
into a `.docx` and drafts it to Debi. Erica's edits are persisted only when she
returns the document — there is no separate save action, because the flow she
asked for is edit-then-send in one pass.

## `letters` actions

Thank-you letter generation, Drive filing and the draft to Debi. There was no
section for this function until 27 Aug 2026; the deployed source was the only
description of it.

The `.docx` is produced by uploading styled HTML to Drive with conversion to a
Google Doc, then exporting that Doc as `.docx`. That avoids hand-building OOXML
and keeps Debi's formatting.

| Action | Notes |
| --- | --- |
| `list` | `{ rules, drafts, needs_letter, batch }`. `rules` is `letter_rules` where active. `needs_letter` is `donation_ack_status` where not thanked. `batch` is `{ max, awaiting }` — how many letters sit in Drive with no draft to Debi yet. |
| `generate` | Writes one letter. `donor_display_name` and `amount` are required. `draft_email: false` stops after Drive so `draft_batch` can pick it up. Returns `address_source`, `address_how` and `matched_account` so a missing address is visible to the caller. |
| `draft_batch` | `{ size?, ids? }` → up to **`BATCH_MAX` = 3** letters already in Drive, gathered into ONE Gmail draft to Debi. `422` when nothing is waiting. |
| `return_document` | `{ text, title?, heading?, original_filename?, applied?, not_applied?, doc_revision_id?, allow_placeholders? }`. Turns edited text into a `.docx` and drafts it to Debi with `applied` / `not_applied` listed in the body. `422` when a `[placeholder]` is still in the text, unless `allow_placeholders`. With `doc_revision_id` it stamps the Needs-editing row: `revised_drive_id`, `status = 'returned'`, `returned_at`, and the edited text into `revision.edited_text`. |
| `mark_sent` | `{ id }`. Moves the `.docx` from the Unsent folder to Erica's **"Thank You Letters"** folder (`1kjl93FPPzC3Q_B4frRxI7fQgPuMrNTrv`, her choice 28 Aug 2026 — the old Sent folder is retired) and sets `status = 'sent'`. **It emails nothing.** The response says so explicitly, because the old button label read as if it did. |
| `delete` | `{ id }`. Removes a draft: the row is deleted, the Drive `.docx` and Doc are trashed (Drive keeps them 30 days) and the Gmail draft is deleted. A letter with `status = 'sent'` is refused with `409` — that is a record, not a draft. The row goes even if Google is unreachable, so a deleted draft cannot reappear on the next load. |

### The template (v9, 28 Aug 2026)

Letters are styled to Erica's own sent letters of 28 Aug 2026 — the reference
copy is "Hoskins Thank You 8.28 edits.docx" in Thank You Letters/Sent
(`1ksE89JXow2p8GJcympicM02m1oUYi_uE`): body **left-aligned** (not justified)
with 12pt after; centered 3.5" logo; **no blank lines between the closing and
the bold signature name** (`SIGN_GAP = 0`); legal line at 10pt; **six centers
including Sterling** in the program paragraph. The ticket sentence follows her
template pattern: "Your [Level] Sponsorship includes N gala tickets, and your
gift is tax-deductible to the extent allowed by law" — count in words, no
dollar figure (`generate` accepts an optional `sponsor_level`). `list` orders
the owed list `donation_date` descending with **nulls last**, so undated gifts
no longer top a newest-first list. Letter rules 7, 11 and 14 were updated to
match.

### The ticket line (v8, 28 Aug 2026)

A gift that came with gala tickets is never receipted as "no goods or services
were provided" — that sentence appears only when the gift carried neither
tickets nor goods. For ticketed gifts the receipt states, in Debi's own wording
(18 Aug 2026, "Re: Victor Hoskins"), below the signature block:

> Please note that the value of the N tickets received is not tax deductible.

Per Erica (28 Aug 2026) **no dollar figure is added** and the phrase "fair
market value" is not used. The v7 guard that refused ticketed gifts without a
`goods_value` (422) is gone — no per-ticket value is needed any more.
`goods_value` is still accepted and, when present without tickets, produces
"the goods and services received" in the same sentence; if Debi ever wants the
deductible amount stated, restoring it to the sentence is one line in
`disclaimer()`. This rule is also `letter_rules` id 14.

Standing directives like this one now also live in **`ops_memory`** — one row
per instruction with `status` proposed / saved / deleted, its source email and
a verbatim quote. Generators should read only `status='saved'` rows for their
scope. Erica reviews proposed rows line by line.

### Nothing is ever sent

`generate` and `draft_batch` create a Gmail **draft** addressed to Debi.
Erica reads it and sends it herself. `mark_sent` is filing in Drive. No action
in this function sends mail, and none writes to the donor.

### Where the address comes from

**`crm_account_map` holds no address** — only `account_number`,
`bloomerang_id`, `full_name`, `primary_email` and `synced_at`. So there is
nothing local to read, and until 27 Aug every letter generated from the
dashboard went out with a name and no address block.

The address is now read **live from Bloomerang** (`GET /constituent/{id}` →
`PrimaryAddress`) at generation time. That needs an account number, and
`donation_ack_status` carries only a donor name, so the account is resolved
first, in this order:

1. `account_number` passed in by the caller
2. `crm_sender_map` by email, then `crm_account_map` by unique email
3. **`constituent_clusters` by normalised name** → `survivor_account`
4. `crm_account_map` by name, only when exactly one row matches

Step 3 is doing the work. A bare name match is not good enough: nearly every
donor name in the mirror hits two to four constituent records because Bloomerang
holds duplicates, and picking one of those would put another person's address on
a tax receipt. The cluster survivor resolves about **three quarters** of the
donors currently owed a letter; an ambiguous name resolves to nothing.

When no address is found the letter is still written, with no address block, and
the response reports `address_source: "none"` plus an `address_how` saying why.
The dashboard shows that as a warning rather than swallowing it. Do not add a
fallback that guesses an address.

### Why `return_document` lives here

It belongs to the Needs-editing workflow, not to thank-you letters, and it is
here anyway for two reasons:

1. This is the only function with a working HTML → Google Doc → `.docx`
   pipeline, plus the Gmail multi-attachment draft path. Duplicating both into
   `docs` would mean two copies of the machinery that produces donor documents.
2. `docs` deliberately **does not write files** — that is stated at the top of
   it and is worth keeping true. `docs.revise` produces text; turning text into
   a file is a different job.

It writes into `DOC_FOLDER`, the same Drive folder `docs` archives Debi's
incoming attachments to, **not** the thank-you Unsent folder: a revised report
is not a letter awaiting her signature.

The `.docx` is rebuilt **from text**, so the original formatting, images, tables
and layout are not carried over. `docs.revise` only ever produces text, so there
is nothing else to carry. The draft body to Debi says this outright, and the
dashboard repeats it above the editor, so the attachment is never mistaken for
an in-place edit of her own file.

### The signature gap

`SIGN_GAP` is the number of blank lines between the closing and
"Debi Alexander". It was one, which left nowhere to sign; it is now 4, roughly
two thirds of an inch at 12pt. This does not conflict with letter rule 1, which
forbids a blank spacer **before** the closing.

## Creating a constituent (account number)

There is no separate "create an account" function. `bloomerang`'s
**`upsert_constituent`** is the path, and it has existed since 16 Aug 2026:

- `{ organization }` with **no** `last_name` creates an Organization. Bloomerang
  requires `FullName` here — `OrganizationName` returns a 301 with "FullName is
  a required field" and the create silently fails.
- `{ first_name, last_name }` creates an Individual.
- With an `account_number`, or when a match is found, it **updates** instead:
  a new email is added as non-primary and the primary is never overwritten.
- On create it writes `crm_account_map` and, when an email was given,
  `crm_sender_map`, so the new account number resolves immediately afterwards.
- The write claims a natural key in `crm_write_ledger` first, so a retry cannot
  double-create. **There is no undo.**

Because the org/person choice is made by *whether a last name is present*, a
caller must send one shape or the other. Sending an organisation together with a
last name creates an Individual named after the organisation.

Until 27 Aug 2026 the dashboard only offered this on rows routed in by an ask
(`extraction.constituent`). Gift rows off the mail scan — donations,
sponsorships, grants — got no create form at all, which is why an unmatched
grant from Micron Technology could not be added without leaving the dashboard.
The Bloomerang card now offers it for any unmatched row, seeded from what the
extraction read. The sender address is only offered when it is external: the
Micron grant arrived from `debi@sparcsolutions.org`, and seeding that would have
written a SPARC address onto a donor record.

## `bloomerang-snapshot` actions

Read-only. It exists **separately from `bloomerang`** on purpose: that function owns every
write into live donor data, and a change to a reporting loader must never be able to break
a money write.

| Action | Notes |
| --- | --- |
| `sync` (default) | `{ skip?, max_pages? }` — pages `GET /transactions` and upserts into `snap_transactions`. Returns `{ upserted, pages, next_skip, total, complete, unmatched_accounts, rows_in_snapshot }`. |

Resumable for the same reason `tasks/scan` is: Bloomerang caps `take` at 50 and a long run
hits `WORKER_RESOURCE_LIMIT`. `complete: false` means call again with `skip = next_skip`.
Scheduled nightly at 07:30 UTC with `max_pages: 8` — results come back newest-first
(`orderBy=Date&orderDirection=Desc`), so 400 rows always covers new activity. A full
rebuild is a manual walk.

**The nightly run therefore returns `complete: false` every time, and that is correct** —
it is not a broken job. It refreshes the newest 400 of ~1,677 and stops; `next_skip` is
deliberately not fed back, because re-walking the whole history daily buys nothing.

So `complete` is the wrong thing to judge the mirror by. **The durable check is the row
count against `total`** in the response, both of which the nightly run reports even though
it only read a slice.

On 28 Aug 2026 that read 1676 against a total of 1677 — one transaction, somewhere in the
older tail, had never been loaded. A manual walk (`{"skip":400,"max_pages":30}`) closed
it: 1677/1677, `complete: true`, `unmatched_accounts: 0`. Re-running `donation-sync`
afterwards promoted nothing, so the missing row was not an unthanked gift.

**`bloomerang-ack` pages the same endpoint the same way and had the same one-row gap** —
`bloomerang_acknowledgments` also held 1676 of 1677 — closed by the same walk. So this is
a property of the paginate-a-slice-nightly pattern, not of one loader: **whenever a
Bloomerang mirror's row count and `total` disagree, walk it from `skip: 400`.** That table
matters more than the snapshot, because `acknowledged` is what says whether a donor has
already been thanked; a row missing from it is a gift that cannot be seen as unthanked.

### What was wrong with the previous snapshot

`snap_transactions` held 1,672 rows with `fund`, `campaign`, `appeal`, `transaction_type`
and `raw` **all null**, and only 52 rows dated in 2026 against 1,676 transactions in
Bloomerang. Its `transaction_id` values did not match the live API's at all, so it was
keyed on something else entirely. Those rows were deleted on 26 Aug 2026 and replaced by a
full load, not merged into it.

The most likely cause of the missing rows: `account_number` was `NOT NULL`, so a page
containing any transaction whose constituent was not yet in `crm_account_map` failed to
insert as a batch. That constraint is now dropped — unmatched revenue still counts, and
`bloomerang_account_id` always identifies the record.

**Every gala question is a question about campaign and appeal**, so a mirror without them
cannot answer any of them, and "is this gift already in Bloomerang?" was being answered
against an incomplete set.

### Columns added 26 Aug 2026

`bloomerang_account_id`, `check_number`, `fee_amount`, `is_refunded`, `designation_count`,
`ticket_quantity`, `registration_type`, `sponsor_level`. All nullable.

A transaction can carry several designations. The row keeps the **first** designation's
fund / campaign / appeal / type — that is what the gala forms write — and the whole payload
goes in `raw`, so a split gift can be read back without another API call.

`ticket_quantity` and `registration_type` are Bloomerang per-designation **custom fields**
(field ids 614403 and 614402). `registration_type` holds the sponsorship level as free text
(`"Sponsorship Level: Friend"`); `sponsor_level` is the part after the colon, and is null
for anything that is not a sponsorship. **It is never inferred from the amount** — that is
how a $500 ticket becomes a $500 sponsorship on a report.

## Live Bloomerang naming, as at 26 Aug 2026

Read from the API, not from a document:

- Fund **`Gala 2026`** (18870272) exists but **nothing uses it** — every 2026 gala gift is
  filed to `Unrestricted` (13314).
- Campaign is **`An Evening To SPARCle 2026`** (4915201) — capital `To`.
- Appeals in use: **`An Evening to SPARCle 2026`** (4926464). Also present and unused:
  `An Evening to SPARCle 2026 Tickets`, `An Evening to SPARCle Sponsorships 2026`,
  and `Gala - Tickets` / `Gala - Sponsorship` / `Gala - Raffle`.

`js/gala-tracking.js` in `sparcwebsite` writes `An Evening to SPARCle 2026` (lowercase `to`)
and `Gala 2026 - Tickets`. **Neither exists.** That file's own comment says "A mismatched
name is the main failure mode", and it is gated behind `ATTRIBUTION_ENABLED = false`.
Turning it on as written would send names Bloomerang does not have.

## `gift-scan` actions

| Action | Notes |
| --- | --- |
| `scan` (default) | `{ days?, max_messages?, max_extractions? }` — reads Erica's mail, classifies each candidate, stages a `crm_inbox` row per gift. Returns `{ donations, sponsorships, grants, matched, needs_confirming, no_constituent, not_a_gift, already_decided, remaining, complete }`. |

Runs three times a day, five minutes behind the task scans so the two do not contend
for the edge worker.

### Why it is not part of `daily-sweep`

`daily-sweep`'s money path had three holes, and all three caused gifts to be **missed**
rather than mis-parsed:

1. Its Gmail query is `from:kat@sparcsolutions.org`. A gift forwarded to Erica by Debi,
   by a donor, or by a board member was never seen at all.
2. It has no notion of a grant. No query, no keywords, nothing.
3. Sponsorships were only caught as a subject keyword on the **guest** query, so a
   sponsorship email was judged as an RSVP rather than as money.

And its gate was three regexes. The tasks pipeline dropped its regex fallback
deliberately — the pre-2026-08-15 version "read email signatures as donor names" — but
the money path kept one, so the half of the sweep that finds actual money was the half
still guessing.

`daily-sweep` is unchanged and still owns Kat's check emails and the guest queue. This
function only adds what was missing.

### One gift per thread, not one per message

The first version keyed the queue on the Gmail **message** id, and a grant thread with
replies produced one gift per reply. On the first real run that meant the Micron award
staged three times and the Jack R. Anderson award three times — twice with a null amount,
because the reply that named the figure was not the reply being read. Approving those
would have pushed the same grant to Bloomerang three times over.

The queue is now keyed on the **thread**. A later message in a thread that already has a
staged gift does not create a second row, but it is not discarded either: if it carries
an amount, a date or a donor the staged row is missing, the row is **enriched** and
`extraction.enriched_from` records which message supplied which field. A reply is usually
where the figure finally appears, so throwing it away loses exactly what is worth having.

The message still gets a `source_tombstones` row saying which staged gift it belongs to,
so a re-run neither re-judges it nor re-stages it.

Four duplicate rows created before the fix were removed on 27 Aug 2026, keeping the most
informative row per thread — an amount beats a null one, oldest as the tiebreak — and
tombstoning the rest.

### It resolves the donor before staging (v3, 28 Aug 2026)

Until v3 `gift-scan` had **no matching step at all**, so every gift it staged carried
`match_constituent_id` null. Two things followed from that, and both were bad:

- The card read "No constituent match" for a donor plainly on file, and
  `bloomerang.approve` refused the push with the same words. **No gift found by this
  scanner could ever reach Bloomerang.**
- The obvious move from that screen — create the constituent — made a **duplicate of a
  record that already existed**. That is how this CRM came to hold two to four rows for
  most donors.

v3 mirrors the **cheap half** of `bloomerang.matchConstituent`: local tables only
(`crm_sender_map`, `crm_account_map`, `constituent_clusters`), no Bloomerang API call.
It has to be a mirror rather than a call, because `bloomerang`'s own `requireUser` does
**not** accept the service role key, so cron cannot reach it over HTTP. If you change
one matcher, change both, or the scan and the push will disagree about who a gift
belongs to.

| Method | Score | Source |
| --- | --- | --- |
| `sender_map` | 1.0 | `crm_sender_map` — a mapping Erica confirmed |
| `account_map_email` | 0.95 | exactly one `crm_account_map` row with that email |
| `cluster_survivor(N records)` | 0.7 | `constituent_clusters.survivor_account` |
| `account_map_name` | 0.65 | exactly one `crm_account_map` row with that name |
| `ambiguous_name` | 0 | more than one name hit — resolves to **nothing** |
| `no_match` | 0 | nothing found |

**Only a score ≥ `CONFIRMED` (0.9) is written into `match_constituent_id`.** Anything
weaker goes to `match_candidates` with the column left null, and the row is flagged
`match_needs_confirming`. That threshold is the whole safety property: the dashboard
renders a populated `match_constituent_id` as a settled green "Matched" and skips the
"use it" confirmation, so a name-only guess in that column silently becomes a decision —
and a wrong account number files a gift onto another donor's record. A name that hits
more than one row resolves to nothing for the same reason.

**Matched on `extraction.donor_email`, never on the message sender.** The Micron grant
arrived from `debi@sparcsolutions.org`; matching on the sender would file the gift
against Debi's own record.

`enrich()` re-runs the match when a later message in the thread finally supplies a donor
name or email, but **only when `match_constituent_id` is still null** — it fills a
blank, it never overwrites a match already on the row.

Two rows staged before v3 were backfilled to the same shape on 28 Aug: the Micron grant
(candidate 3423) and the "Grant Agreement Received" Jack R. Anderson row (candidate 210),
both `account_map_name` at 0.65, both left unmatched and flagged for confirmation.

### What it will not do

It never writes to Bloomerang and never creates a constituent. Every hit lands in
`crm_inbox` at `needs_review` — the existing approve-and-push path where Erica edits the
record before anything is sent.

It never invents a figure. A gift whose amount is not stated is staged with `amount`
null and flagged `amount_missing`, because a plausible amount on a donor record is worse
than a blank one: the blank gets asked about, the plausible one does not. The same holds
for the donor, the date and the designation, each with its own flag.

A negative verdict is written to `source_tombstones` with `source: 'gift'`. Without it
the scan spends its whole budget re-judging the same rejected mail and never advances —
the same lesson `daily-sweep` learned with `rsvp_candidates.status = 'no_signal'`.

`source` on the staged row is `donation`, `sponsorship` or `grant`, which is what the
Bloomerang tab sections on. `crm_inbox_source_check` was widened on 26 Aug 2026 to
permit the last two.

**First live run, 26 Aug 2026:** found a **$6,000 Micron Technology grant** arriving via
Benevity — a grant, from a sender that is not Kat, so invisible to both of the old
sweep's queries. It flagged `date_missing` rather than guessing, and declined to split
the award into the $1,000 / $5,000 that an inline comment in the thread implied, because
the award letter states a single figure.

## Scheduled jobs

| Job | Schedule (UTC) | Calls |
| --- | --- | --- |
| `sweep-email` | 11:00 Mon–Fri | `daily-sweep` |
| `sync-bloomerang-ack` | 11:20 Mon–Fri | `bloomerang-ack` |
| `sync-constituents` | 07:00 Sun | `bloomerang` `sync_accounts` |
| `sync-bloomerang-transactions` | 07:30 daily | `bloomerang-snapshot` |
| `tasks-scan-0800` / `-1200` / `-1700` | 12:00 / 16:00 / 21:00 | `tasks` `scan` |
| `gift-scan-0800` / `-1200` / `-1700` | 12:05 / 16:05 / 21:05 | `gift-scan` `scan` |
| `asks-autodraft-1200` / `-1600` / `-2100` | 12:10 / 16:10 / 21:10 | `asks-autodraft` `run`, `limit: 10` |
| `promote-donations` | 07:45 daily | `donation-sync` |

Each family is offset five minutes from the last so they do not contend for the edge
worker: tasks scan at `:00`, gift scan at `:05`, answer drafting at `:10`.

`call_edge` reads `system_config.cron_token`; `call_edge_svc` reads `tasks_cron_token`. Both
are app session tokens, not API keys, so they survive Supabase key rotation — but they
expire like any session.

**`cron_token` was expired and every job using it had been failing 401 silently** — the
email sweep, the acknowledgement sync and the constituent sync. Rotated 26 Aug 2026 to a
365-day session. `pg_net` writes responses to `net._http_response`; a 401 there is the first
place to look when a job stops having any effect.

`sweep-gala-outreach` was **unscheduled** on 26 Aug 2026. Its 145 collected rows were set to
`dismissed` rather than deleted: they were gathered by subject keyword and are mostly Debi
writing to Erica with instructions, not invitations to prospects.

## Audit trail

Edits, dismissals, guest acceptances and password changes all write to
`audit_log` with the acting user's email. Do not add a code path that mutates
data without an audit entry.

The `tasks`, `asks` and `docs` functions follow the same rule — scans, drafts,
sends, ticks and deletions all write an `audit_log` row, attributed to
`system:cron` when a scheduled job made the call rather than a person.

One known gap: `restore_dismissed` deletes the `question_dismissals` row without
writing an audit entry, so an undone dismissal leaves the original
`question_dismissed` entry standing with nothing recording that it was reversed.
