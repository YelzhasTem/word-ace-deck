# Study data integrity

## Trust model

The browser reports raw study input; it does not decide objective correctness or write derived
learning statistics. An authenticated client starts a session with `start_study_session`, obtains a
server-bound question with `issue_study_question`, submits the raw answer to
`record_study_answer`, and closes timed sessions with `complete_study_session`.

These RPCs derive the user from `auth.uid()`, verify access to the selected deck and card, use the
database clock, and update the event plus all derived records in one transaction. They are
`SECURITY DEFINER` functions with a fixed `search_path`; anonymous execution is revoked.

The public boolean overload has been removed. The aggregate updater still accepts the server's
computed boolean internally, but it lives in the non-exposed `private` schema and browser roles have
neither schema usage nor function execution.

## Mode classification

| Mode      | UI                                                          | Verification    | Accepted raw input      |
| --------- | ----------------------------------------------------------- | --------------- | ----------------------- |
| `type`    | Typed translation, either direction                         | Server-verified | Submitted text          |
| `recall`  | Delayed Recall typed answer, either direction               | Server-verified | Submitted text          |
| `speed`   | Timed multiple choice                                       | Server-verified | Issued option UUID      |
| `deep`    | Untimed multiple choice                                     | Server-verified | Issued option UUID      |
| `study`   | Flashcard reveal followed by Know/Try again                 | Self-reported   | Self-assessment boolean |
| `reverse` | Bidirectional flashcard reveal followed by Know/Do not know | Self-reported   | Self-assessment boolean |
| `assoc`   | Whether a memory association helped                         | Self-reported   | Self-assessment boolean |

The names do not determine trust by themselves. For example, `reverse` is self-reported because its
actual interaction reveals the answer and asks the learner to assess recall. The server selects
`verification_type` from the session mode; the client cannot supply it.

## Data ownership

Server-owned study data:

| Table                             | Purpose                                       | Client access                     |
| --------------------------------- | --------------------------------------------- | --------------------------------- |
| `study_sessions`                  | Session lifecycle and completion key          | Read own rows; write through RPC  |
| `study_session_cards`             | Private card/version snapshots                | No browser table access           |
| `study_questions`                 | Private expected answer and question contract | No browser table access           |
| `study_question_options`          | Private option correctness                    | No browser table access           |
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
- `client_question_key` makes question issuance idempotent and cannot be reused for a different
  session, card, or direction.
- `idempotency_key` allows a network retry to return the existing answer without incrementing any
  counter twice. Reusing the key with different raw text, option, result, or timing fails.
- `completion_key` makes completion idempotent. A different key cannot complete the same session
  again.
- Completed sessions reject further answers.
- A card must belong to the session deck. Private decks are studyable only by their owner; public and
  unlisted decks can be studied by signed-in users while visible.
- Speed score, accuracy, and maximum combo are computed from the session's ordered event rows.

## Answer verification

At session creation, the server snapshots each card's term, definition, and `updated_at`. Questions
always use that snapshot, so editing a card in another tab cannot change the expected answer during
an active session. Deleted cards and inaccessible decks are rejected by the write path.

Text comparison preserves the previous UI behavior: lowercase comparison, Unicode NFD
normalization, removal of combining marks and limited punctuation, whitespace collapse,
comma/slash/semicolon alternatives, and the existing bounded Levenshtein tolerance. Exact matching
remains available for phrases longer than the extension's fuzzy-comparison limit.

For multiple choice, the database selects distinct distractors from the session snapshot and stores
correctness in `study_question_options`. Before an attempt the RPC returns only `{ id, text }` for
each option. The browser submits one option UUID; random IDs and IDs from another question fail.
The expected answer and correct option ID are returned only after the event is recorded.

## Integrity constraints

The database enforces nonnegative counters and timings, bounded mastery/accuracy/recall scores,
allowed learning stages and modes, valid speed durations, chronological due dates, composite
card/deck foreign keys, and unique retry/completion keys. The first migration audits existing rows
and aborts if normalization would be necessary; it never silently rewrites historical data.

`total_xp` remains zero unless a future server-owned award algorithm is deliberately introduced.
Do not calculate or update XP in the browser.

## Developer checklist

1. Send raw study actions through the typed text, multiple-choice, or self-reported method in
   `src/lib/study-session.ts`.
2. Never call `insert`, `update`, `upsert`, or `delete` on a server-owned study table from frontend
   code.
3. Do not accept `user_id`, `correct`, `verification_type`, mastery, score, streak, interval,
   timestamps, or aggregate counters as trusted client input.
4. Give every retryable action a stable UUID idempotency key and reuse that key on retry.
5. Add or update integration scenarios for any new study mode or statistic.
6. Run `npm run check:study-integrity` before review. The GitHub workflow also starts an isolated
   Supabase instance and tests two temporary users through Supabase JS, REST, and RPC.

## Rollout and rollback

`20260729180000_trusted_study_write_api.sql` introduced the aggregate write path and
`20260729210000_close_direct_study_writes.sql` revoked direct writes. The answer-verification rollout
then used three forward-only phases: `20260729223000` added private snapshots and a parallel safe
API, `20260729230000` added the canonical safe overload, and `20260729233000` moved the legacy
boolean implementation into the private schema after the new frontend was live.

If the frontend must be rolled back after the second phase, roll back the frontend together with an
explicit temporary grant migration reviewed by a security owner. Do not remove constraints or
disable RLS. The database migrations themselves are forward-only; recovery should use a new audited
migration.

## Remaining client input

The server necessarily accepts the learner's selected card, study direction, self-assessment in the
three subjective modes, and measured `response_ms`. These values can affect the learner's own study
history, but none allows the client to set derived counters or claim objective correctness. Product
analytics should distinguish `server_verified` from `self_reported` events.
