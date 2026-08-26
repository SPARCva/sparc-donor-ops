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
| `gala-outreach` | Sponsor outreach tracking |

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
| `list` | `{ answers, pending, pending_total, counts }`. `pending` is open tasks with no answer yet, oldest 100 of them. |
| `generate` | `{ task_id }`. Drafts one answer. `422` when the task was added by hand or its Gmail thread cannot be read — with nothing to source from, refusing is the feature. |
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
