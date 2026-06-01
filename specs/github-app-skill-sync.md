---
summary: "Plan for ClawHub GitHub App org repository sync for source-managed skills."
read_when:
  - Implementing GitHub App repository sync
  - Changing skill source-of-truth, org publishing, or sync ownership semantics
  - Reviewing source-managed skill deletion, unlinking, or manual publish behavior
---

# GitHub App Skill Sync

## Goal

Let a ClawHub org install a ClawHub GitHub App, link one or more GitHub
repositories, and keep selected skills in that org synced from pushes to those
repositories.

An org GitHub link must not make every org skill source-managed. Only skills
explicitly mapped to a linked repository path are synced. Manual or CLI-managed
skills can continue to live in the same org and are ignored by repository sync.

## Product Model

- A ClawHub org can connect a GitHub App installation.
- Org owners/admins can link repositories that the app installation can read.
- Each repository link defines:
  - repo identity: `owner/name`, GitHub repo id, installation id
  - branch/ref to sync, defaulting to the repository default branch
  - one or more sync roots, defaulting to repo root
  - sync mode: `discover` or `mapped`
- `discover` mode publishes every valid skill candidate under the configured
  roots, using the candidate folder as the default slug source.
- `mapped` mode syncs only explicit repo path to ClawHub slug mappings.
- Source-managed skills are still normal org skills for browsing, installing,
  stats, moderation, and version history.
- Manual skills in the org are unaffected unless an admin explicitly adopts
  them into a source mapping.

## Non-Goals For V1

- Writing back to GitHub.
- Syncing private submodules or Git LFS pointers.
- Syncing packages/plugins through this path. Packages already have a separate
  trusted-publisher model.
- Automatically deleting org skills that were never source-managed.
- Cross-org shared repository links.

## Source Ownership Invariants

1. A skill is source-managed only if it has an active source link row.
2. A sync job may only publish or change skills whose active source link points
   at the job's repository and path.
3. A repository sync must never create, update, soft-delete, restore, rename, or
   retag manual org skills.
4. If a repo candidate conflicts with an existing manual org skill slug, sync
   stops for that candidate and reports a conflict. It does not overwrite.
5. If an admin adopts an existing manual skill into source management, store the
   source link first, then future syncs may publish versions for that skill.
6. Manual publish UI/CLI should refuse direct version publishes to a
   source-managed skill unless the actor first unlinks or explicitly overrides
   source management with an audited admin action.
7. Moderation hides, scanner hides, bans, and soft-deletes keep their existing
   authority. Sync may publish a new version only when the current write path
   would permit the org to publish normally, and it must not lift moderation.

## Data Model

Add `githubAppInstallations`:

- `installationId: string`
- `accountLogin: string`
- `accountId: string`
- `accountType: "User" | "Organization"`
- `createdByUserId: Id<"users">`
- `createdAt`, `updatedAt`
- `suspendedAt?`, `deletedAt?`

Indexes:

- `by_installation_id`
- `by_account_id`

Add `publisherGitHubLinks`:

- `publisherId: Id<"publishers">`
- `installationId: string`
- `githubAppInstallationId: Id<"githubAppInstallations">`
- `linkedByUserId: Id<"users">`
- `createdAt`, `updatedAt`
- `deletedAt?`

Indexes:

- `by_publisher`
- `by_installation_id`
- `by_publisher_installation_id`

Add `publisherGitHubRepositories`:

- `publisherId: Id<"publishers">`
- `githubLinkId: Id<"publisherGitHubLinks">`
- `installationId: string`
- `repoFullName: string`
- `repoId: string`
- `defaultBranch: string`
- `syncRef: string`
- `syncRoots: string[]`
- `mode: "discover" | "mapped"`
- `enabled: boolean`
- `lastSyncedCommit?`
- `lastSyncStatus?: "idle" | "queued" | "running" | "succeeded" | "failed"`
- `lastSyncError?`
- `lastSyncedAt?`
- `createdAt`, `updatedAt`, `deletedAt?`

Indexes:

- `by_publisher`
- `by_installation_repo_id`
- `by_repo_full_name`
- `by_enabled_status`

Add `skillSourceLinks`:

- `publisherId: Id<"publishers">`
- `skillId?: Id<"skills">`
- `repositoryId: Id<"publisherGitHubRepositories">`
- `repoFullName: string`
- `repoId: string`
- `path: string`
- `slug: string`
- `readmePath: string`
- `status: "active" | "conflict" | "missing" | "disabled"`
- `conflictReason?`
- `lastSyncedCommit?`
- `lastSyncedVersionId?`
- `lastFingerprint?`
- `createdByUserId: Id<"users">`
- `createdAt`, `updatedAt`, `disabledAt?`

Indexes:

- `by_publisher`
- `by_skill`
- `by_repository`
- `by_repository_path`
- `by_publisher_slug`
- `by_status_updated`

Add `githubSkillSyncJobs`:

- `publisherId: Id<"publishers">`
- `repositoryId: Id<"publisherGitHubRepositories">`
- `repoFullName: string`
- `ref: string`
- `commit: string`
- `status: "queued" | "running" | "succeeded" | "failed" | "cancelled"`
- `reason: "push" | "manual" | "repository_linked" | "backfill"`
- `requestedByUserId?`
- `startedAt?`, `finishedAt?`, `error?`
- `counts`: discovered, published, skipped, conflicted, missing
- `createdAt`, `updatedAt`

Indexes:

- `by_repository_status`
- `by_repository_commit`
- `by_status_created`

Add `githubAppSetupStates`:

- `stateHash`
- `publisherId`
- `requestedByUserId`
- `targetAccountId?`
- `nonce`
- `expiresAt`
- `consumedAt?`
- `createdAt`

Indexes:

- `by_state_hash`
- `by_publisher`
- `by_expires_at`

Add `githubWebhookDeliveries`:

- `deliveryId`
- `event`
- `installationId?`
- `repoId?`
- `status: "processing" | "processed" | "failed"`
- `error?`
- `receivedAt`
- `updatedAt`

Indexes:

- `by_delivery_id`
- `by_received_at`

Add `githubAppInstallationClaims`:

- `installationId`
- `accountId`
- `senderAccountId`
- `event`
- `receivedAt`
- `updatedAt`

Indexes:

- `by_installation_id`

Use `skillVersions.sourceProvenance` for the per-version source proof. Extend it
later only if needed with `installationId`, `repoId`, and `syncJobId`. Keep the
existing `kind: "github"` shape for compatibility with the HTTP API.

## GitHub App Setup

GitHub App permissions:

- Repository contents: read-only.
- Metadata: read-only.
- Webhooks: `push`, `installation`, `installation_repositories`,
  `repository`.

App callback flow:

1. Org admin starts from org settings.
2. Redirect to GitHub App install/select repositories page.
3. ClawHub creates a short-lived HMAC-signed setup state and stores only its
   hash, nonce, publisher id, requesting user id, optional target GitHub account
   id, and expiry.
4. GitHub redirects back with installation id and state.
5. Server verifies the state signature, table hash, nonce, expiry,
   single-consumption status, current user, and current publisher admin role.
6. Server fetches installation/repository metadata using an app installation
   token.
7. User-account installs are accepted only when the installation account id
   matches the current ClawHub user's GitHub provider account id.
8. Organization installs require a target GitHub account id in the setup state
   and a signed GitHub installation webhook claim whose installation account id
   matches that target and whose sender account id matches the current ClawHub
   user's GitHub provider account id. If the redirect outruns the webhook, the
   completion step fails cleanly and can be retried after the webhook arrives.
9. Server stores the link. Repository rows are disabled by default until a
   publisher admin opts them into sync.

HTTP webhook endpoint:

- Add a Convex HTTP action under `convex/http.ts`.
- Verify `X-Hub-Signature-256` using `GITHUB_APP_WEBHOOK_SECRET`.
- Deduplicate by `X-GitHub-Delivery`, but only mark a delivery processed after
  event work succeeds. Failed deliveries stay retryable.
- Store or schedule work through internal mutations/actions only.
- Ignore events for installations/repositories not linked to a ClawHub
  publisher.
- Repository removal, installation deletion, and installation suspension disable
  the affected repository links and their non-disabled source links. Manual org
  skills remain untouched.
- Repository rename events update both repository rows and source-link
  `repoFullName` values so source provenance checks continue to match.

Required env:

- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_WEBHOOK_SECRET`
- optional `GITHUB_APP_STATE_SECRET` for setup-state HMAC; falls back to the
  webhook secret when unset
- optional `GITHUB_APP_CLIENT_ID` / callback secret if using setup callbacks

## Sync Flow

Repository link:

1. Admin selects a repo and sync settings.
2. Insert or update `publisherGitHubRepositories`.
3. Queue an initial `githubSkillSyncJobs` row for the configured ref.

Push webhook:

1. Verify webhook signature.
2. Resolve linked repositories by installation id and repo id.
3. Ignore pushes outside `syncRef`.
4. Insert a queued job keyed by repository plus commit. If an equivalent queued
   or running job exists, skip.
5. Cancel older queued push jobs for the same repository/ref when a newer push
   arrives. Ignore deletion pushes with GitHub's all-zero `after` SHA.
6. Schedule the sync action.

Sync action:

1. Acquire a queued job only when no active sync is already running for the
   repository. Waiting jobs reschedule themselves so concurrent pushes cannot
   derive and publish the same next version.
2. Mark older queued jobs for the same repository/ref as cancelled when a newer
   commit supersedes them.
3. Mint a GitHub installation token.
4. Fetch the commit tree/archive for the pinned commit.
5. Reuse the existing GitHub import safety pipeline:
   - allowed hosts only
   - zip/file/byte count caps
   - text-file filter
   - `SKILL.md` / `skills.md` candidate detection
   - relative markdown reference expansion
6. Filter candidates to repository sync roots and mode.
7. For each candidate:
   - normalize slug/display name/version defaults
   - find or create the `skillSourceLinks` row
   - verify the link owns the target skill or can create it
   - compare fingerprint against `lastFingerprint`
   - if unchanged, skip
   - store files and call the existing skill publish pipeline with
     `ownerPublisherId`
   - set `sourceProvenance` to repo/ref/commit/path
   - update link status, fingerprint, synced commit, and version id
8. Mark linked source paths not present in the repo as `missing`. Do not delete
   by default.
9. Update repository/job status and counts.

Publish actor:

- V1 should use the user who linked or requested the sync as `createdByUserId`
  and audit actor, while tagging audit metadata as GitHub App sync.
- If that user loses access, require another org owner/admin to re-authorize the
  link before future syncs.
- Bypass GitHub account-age checks for app sync only after installation,
  publisher membership, repository access, and source link authorization pass.

## Conflict Handling

Same org slug exists and has no source link:

- Mark candidate/link as `conflict`.
- Show "manual skill already uses this slug".
- Offer admin actions:
  - adopt existing skill into this source path
  - map repo path to a different slug
  - ignore this path

Same repo path maps to another skill:

- Mark conflict.
- Require admin to disable one mapping.

Same skill linked to another repo path:

- Reject by default.
- Allow explicit source move only from org owner/admin, preserving an audit log.

Repo deletion or app repository removal:

- Disable the repository link.
- Mark active source links under it as `disabled`.
- Do not delete skills.

File deletion from repo:

- Mark source link as `missing`.
- Optional future setting: soft-delete only source-managed skills after a grace
  period. This must never affect manual org skills.

## UI Plan

Org settings:

- Add "GitHub sync" tab.
- Show app installation status, connected GitHub account, and linked repos.
- Add "Connect GitHub App" and "Link repository" controls.
- Repository detail shows branch/ref, roots, mode, last sync, errors, and
  source-managed skill mappings.
- Provide manual "Sync now".

Skill settings:

- For source-managed skills, show source repo/path/commit and last sync status.
- Disable normal upload/publish controls or require "unlink source management"
  before manual publish.
- Add "unlink source management" with a clear warning that future repo pushes
  will no longer update this skill.

Skill detail/API:

- Reuse existing provenance display where possible.
- Optionally add a source-managed badge once sync behavior is reliable.

## API/CLI Plan

Internal Convex functions:

- `githubApp.beginPublisherInstall`
- `githubApp.completePublisherInstall`
- `githubApp.listPublisherRepositories`
- `githubApp.linkPublisherRepository`
- `githubApp.updatePublisherRepositorySyncSettings`
- `githubApp.disablePublisherRepository`
- `githubApp.queueRepositorySync`
- `githubApp.runRepositorySyncInternal`
- `githubApp.adoptSkillSourceLink`
- `githubApp.disableSkillSourceLink`

CLI can come later:

- `clawhub org github repos`
- `clawhub org github link <repo>`
- `clawhub org github sync <repo>`

Do not expose broad public API writes until the UI path and audit model are
stable.

## Security And Abuse Controls

- Verify every webhook signature.
- Treat installation id and repo id as identities; repo names can change.
- Fetch contents only with installation tokens scoped to the installed repo.
- Keep existing publish validation, text-only limits, static scan, security scan,
  dependency scan, quality gates, and moderation behavior.
- Rate-limit manual "Sync now" by publisher/repository.
- Debounce push storms by repository and commit.
- Cap candidates per repository per sync.
- Make source link updates indexed; no full-table scans in cron/webhook paths.
- Never trust repo files to choose a different publisher, owner, or source path
  outside the configured roots.

## Rollout Phases

1. Schema and spec foundation
   - Add the new tables and generated types.
   - Add internal helpers for source-link ownership checks.
   - Add tests for "manual org skills are ignored".

2. GitHub App connection
   - Add app install callback, webhook verification, installation repository
     storage, and org settings UI.
   - Do not sync content yet.

3. Manual repository sync
   - Implement linked repository settings and "Sync now".
   - Reuse `convex/lib/githubImport.ts` detection/storage logic.
   - Publish only source-linked skills or newly discovered non-conflicting
     candidates.

4. Push-triggered sync
   - Enable webhook queueing and debounce.
   - Add job history and failure display.

5. Source-management UX hardening
   - Disable direct manual publishes to source-managed skills.
   - Add adopt/unlink/mapping conflict resolution.
   - Add source-managed provenance display.

6. Optional deletion policy
   - Keep v1 as `missing` only.
   - Later add per-repository "soft-delete missing source-managed skills after N
     days" if product wants it.

## Test Plan

Unit tests:

- Webhook signature verification and dedupe.
- Repository/root candidate filtering.
- Discover mode does not touch manual org skills.
- Mapped mode syncs only explicit mapped paths.
- Existing manual slug conflict blocks sync.
- Existing source-managed slug publishes a new version only on fingerprint
  change.
- Missing repo path marks `skillSourceLinks.status = "missing"` without deleting
  skills.
- Repository removal disables source links without deleting skills.

Integration tests:

- Link repo, run initial sync, verify source provenance on the version.
- Push webhook queues one job for the linked repository/ref.
- Push to unlinked repo or wrong branch is ignored.
- Org member without admin role cannot link repos or adopt manual skills.
- Source-managed skill cannot be manually overwritten without unlink/override.

Gates:

- `bunx convex codegen`
- targeted Vitest tests for GitHub sync helpers
- `bun run ci:static`
- `bun run ci:unit`
- `bun run ci:types-build` for schema/backend changes
