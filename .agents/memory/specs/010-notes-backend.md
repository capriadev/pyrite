# 010 Notes backend

## Objective
Add the Notes domain (backend only): encrypted notes with private mode, shared-salt
searchable content, and a unified cross-domain groups table.

## Scope
- Unified `groups` table (domain column) reused by apis and notes.
- `notes` table with encrypted content (light profile, shared section salt), private flag,
  pinned flag, and created/updated/accessed timestamps.
- Notes private section (`notes_private`, medium profile, shared salt) with its own passphrase.
- Restore Secrets API: CRUD notes, group CRUD per domain, content reveal, content search.

## Approach
- Migrate `api_groups` to `groups` (domain='apis') and re-point `api_keys.group_id`.
- Derive one key per section at unlock time (shared salt stored in settings), enabling
  in-memory content search. AAD is the note id.
- Private notes are tagged `private=true` and encrypted with the private section key.
- Search covers title (plaintext) + content (decrypted in memory while unlocked).

## Acceptance criteria
- Notes CRUD works; listing returns title, snippet, dates, pinned, private flag.
- Content search returns matches from title and content.
- Private notes are only decryptable while the `notes_private` section is unlocked.
- Groups are isolated by domain (apis sees only apis groups, notes only notes groups).
- Only the `notes` section passphrase is required for public notes.

## Verification (smoke test)
End-to-end smoke against dev confirmed every criterion. Fixes applied during verification:
- **Lock is the source of truth.** `NotesService` no longer trusts its own key cache to
  decide visibility; it re-validates against `AuthService.isSectionUnlocked` and evicts
  stale cache entries. Previously a locked `notes_private` still leaked content on
  `GET /notes/:id/content` and snippets in `GET /notes`.
- **Search respects the lock.** Private notes are skipped before any title/content match
  while their section is locked.
- **Duplicate groups return 409.** `GroupsService.create` validates name presence and
  uniqueness before insert (was surfacing a raw 500 from the DB unique constraint).