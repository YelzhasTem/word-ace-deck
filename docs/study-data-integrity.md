# Study data integrity

## Trust model

The browser reports a study action; it does not write derived learning statistics. An authenticated
client starts a session with `start_study_session`, submits each answer with
`record_study_answer`, and closes the session with `complete_study_session`.

These RPCs derive the user from `auth.uid()`, verify access to the selected deck and card, use the
database clock, and update the affected records in one transaction. They are `SECURITY DEFINER`
functions with a fixed `search_path`; anonymous execution is revoked.

The browser currently sends `p_result` as a boolean because the existing study modes validate the
answer in the UI. Consequently, users cannot set mastery, score, streak, intervals, dates, counters,
or aggregates directly, but a modified client can still claim that its own answer was correct. This
is the remaining documented trust boundary. A future server-verifiable answer format should send a
normalized answer or selected choice instead of a boolean.

## Data ownership

Server-owned study data:

| Table                             | Purpose                                       | Client access                     |
| --------------------------------- | --------------------------------------------- | --------------------------------- |
| `study_sessions`                  | Session lifecycle and completion key          | Read own rows; write through RPC  |
| `study_events`                    | Append-only answer history                    | Read own rows; insert through RPC |
| `card_progress`                   | Mastery, stage, due date, counters, timings   | Read own rows; write through RPC  |
| `delayed_recall_entries`          | Recall score, interval, due date, counters    | Read own rows; write through RPC  |
| `speed_runs`                      | Server-derived score, accuracy, and combo     | Read own rows; write through RPC  |
| `streak_days`                     | Server-timestamped activity days              | Read own rows; write through RPC  |
| `last_studied_decks`              | Server-timestamped recent activity            | Read own rows; write through RPC  |
| `profile_private` learning fields | `streak_days`, `last_active_date`, `total_xp` | Server-owned columns              |

`cards.known` is a subjective owner marker, not trusted mastery. It is still changed through
`set_card_known` or `reset_deck_known` so it cannot be mixed with unrestricted card updates.
`deck_learning_settings` and `card_associations` remain user-authored settings/content, but their RLS
requires both ownership of the row and access to the referenced deck or card.

## Session and retry rules

- `client_session_key` makes session creation idempotent for one user.
- `idempotency_key` allows a network retry to return the existing answer without incrementing any
  counter twice. Reusing the key with different parameters fails.
- `completion_key` makes completion idempotent. A different key cannot complete the same session
  again.
- Completed sessions reject further answers.
- A card must belong to the session deck. Private decks are studyable only by their owner; public and
  unlisted decks can be studied by signed-in users while visible.
- Speed score, accuracy, and maximum combo are computed from the session's ordered event rows.

## Integrity constraints

The database enforces nonnegative counters and timings, bounded mastery/accuracy/recall scores,
allowed learning stages and modes, valid speed durations, chronological due dates, composite
card/deck foreign keys, and unique retry/completion keys. The first migration audits existing rows
and aborts if normalization would be necessary; it never silently rewrites historical data.

`total_xp` remains zero unless a future server-owned award algorithm is deliberately introduced.
Do not calculate or update XP in the browser.

## Developer checklist

1. Send raw study actions through the RPC client in `src/lib/study-session.ts`.
2. Never call `insert`, `update`, `upsert`, or `delete` on a server-owned study table from frontend
   code.
3. Do not accept `user_id`, mastery, score, streak, interval, timestamps, or aggregate counters as
   trusted client input.
4. Give every retryable action a stable UUID idempotency key and reuse that key on retry.
5. Add or update integration scenarios for any new study mode or statistic.
6. Run `npm run check:study-integrity` before review. The GitHub workflow also starts an isolated
   Supabase instance and tests two temporary users through Supabase JS, REST, and RPC.

## Rollout and rollback

`20260729180000_trusted_study_write_api.sql` is the compatible phase: it adds sessions, RPCs, foreign
keys, checks, and idempotency while the previous frontend can still run. After the RPC frontend is
deployed, `20260729210000_close_direct_study_writes.sql` revokes direct writes and leaves only
owner-scoped reads plus the trusted RPC path.

If the frontend must be rolled back after the second phase, roll back the frontend together with an
explicit temporary grant migration reviewed by a security owner. Do not remove constraints or
disable RLS. The database migrations themselves are forward-only; recovery should use a new audited
migration.
