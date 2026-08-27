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
| `mark` | `{ id, status }` — `pending`, `revised`, `returned` or `dismissed`. |

Reconstructing both sides of a diff is a read of the file, not a guess at
intent: `<w:del>` runs are her original, `<w:ins>` runs are the text with her
changes applied.

**Nothing here rewrites a file.** Producing a revised `.docx` or editing a
`.pptx` in place is a write path that does not exist, so every instruction is
stored as `needs_human` and stays that way until a person ticks it. Do not add
a code path that reports a change as applied when it has not been.

## `bloomerang-snapshot` actions

Read-only. It exists **separately from `bloomerang`** on purpose: that function owns every
write into live donor data, and a change to a reporting loader must never be able to break
a money write.

| Action | Notes |
| --- | --- |
| `sync` (default) | `{ skip?, max_pages? }` — pages `GET /transactions` and upserts into `snap_transactions`. Returns `{ upserted, pages, next_skip, total, complete, unmatched_accounts, rows_in_snapshot }`. |

Resumable for the same reason `tasks/scan` is: Bloomerang caps `take` at 50 and a long run
hits `WORKER_RESOURCE_LIMIT`. `complete: false` means call again with `skip = next_skip`.
Scheduled nightly at 07:30 UTC with `max_pages: 8` — results come back newest-first, so 400
rows always covers new activity. A full rebuild is a manual walk.

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
| `scan` (default) | `{ days?, max_messages?, max_extractions? }` — reads Erica's mail, classifies each candidate, stages a `crm_inbox` row per gift. Returns `{ donations, sponsorships, grants, not_a_gift, already_decided, remaining, complete }`. |

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
