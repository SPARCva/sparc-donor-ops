# Backend reference

The backend is Supabase Edge Functions on project ref `ldxpockcgcxvsrbyhcnt`.
It is already deployed and live. This repo holds only the frontend; the
function source lives in Supabase.

Base URL: `https://ldxpockcgcxvsrbyhcnt.supabase.co/functions/v1/<slug>`

## Functions in use by this dashboard

| Slug | Purpose |
| --- | --- |
| `donor-ops` | Everything the dashboard does — auth, dashboard payload, row edits, notes, guest review |
| `bloomerang` | Approve / reject / undo pushes of inbox records into Bloomerang |
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

## Flags the dashboard raises

`sponsor_level_mismatch`, `sponsor_missing_amount`,
`tuition_missing_participant`, `donation_missing_donor`,
`donation_uncategorised`, `donation_parse_gap`, `check_email_review`,
`letter_incomplete`.

Sponsorship tiers used for the mismatch check: Event Sponsor 25,000;
Champion 10,000; Hero 7,500; Leader 5,000; Partner 2,500; Advocate 1,000;
Friend 500.

## Audit trail

Edits, dismissals, guest acceptances and password changes all write to
`audit_log` with the acting user's email. Do not add a code path that mutates
data without an audit entry.
