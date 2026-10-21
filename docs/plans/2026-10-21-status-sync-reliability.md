# Status synchronization reliability implementation plan

> **For agents:** Use viterbit:executing-plans and test-driven-development to implement this plan task by task.

**Goal:** Correct every finding in the project review and make event processing, status selection, and Slack delivery reliable.

**Architecture:** Keep the existing providers, SQLite snapshots, ordered rules, and Slack client. Verify raw webhook bodies before parsing and validating them. Persist source timestamps, serialize Slack delivery, and retry the latest desired status from SQLite after failures and on startup.

**Tech Stack:** Node 22, TypeScript, Fastify, SQLite, Zod, Slack Web API SDK, Vitest.

## Scope and decisions

- Existing rule order remains the priority mechanism; equal-priority events use newest source timestamp, then ascending ID.
- Environment interpolation applies to credentials and provider identity fields only; event templates retain their placeholders.
- Enabled providers require a nonempty identity and secret. Unknown providers and malformed payloads fail explicitly.
- `/status` is disabled without a configured status token and requires a bearer token when enabled. Its response distinguishes desired status from last acknowledged status and pending delivery.
- Webhooks acknowledge durable local acceptance; Slack delivery is serialized and recovered independently, with failures caught and observable. They do not acknowledge unpersisted work.
- SQLite remains the durable source of desired state. No external broker or new database is required.
- GitHub handles review completion/removal, close/reopen, and issue assignment transitions. Linear handles reassignment/unassignment, removal/archive, and semantic workflow states.
- Older or repeated source versions cannot overwrite a newer snapshot. Equal source timestamps favor inactive tombstones, accounting for GitHub's second-level timestamp precision.
- SQLite marks snapshots whose timestamps came from the source. Existing databases retain their snapshots and accept the first authoritative source version before enforcing source ordering.
- Startup reapplies persisted desired state. Shutdown stops recovery timers and drains delivery before closing SQLite.
- Tests cover real parsers, SQLite, rule evaluation, HTTP routes, and SDK HTTP serialization. Local Slack contract tests are integration tests, not live Slack end-to-end tests.
- Keep activity semantics unchanged: events represent pending work; no new focus mode or manual override feature.

## Task 1: Configuration

Files: `src/config.ts`, `src/config.test.ts`, `slacker.config.example.yaml`.

1. Add regression tests loading actual YAML, preserving event placeholders, rejecting missing credentials/identities and unknown providers, and loading an optional status token.
2. Run `npm run test:run -- src/config.test.ts`; confirm the new assertions fail before implementation.
3. Parse YAML before interpolating only known configuration fields. Validate identities at startup, retain existing environment variable names, and expose parsed identities in provider configuration.
4. Re-run the targeted tests and TypeScript build.

## Task 2: Webhook transport and provider transitions

Files: `src/providers/provider.ts`, `src/providers/github.ts`, `src/providers/linear.ts`, provider tests, and a shared webhook transport helper/test if needed.

1. Analyze callers before changing exported parsers or callback signatures.
2. Add failing route tests for raw-body signatures, malformed payloads, async callbacks and processing errors. Add failing lifecycle tests for reviews, assignments, removals, archive and reopen.
3. Verify HMAC against raw bytes inside encapsulated Fastify routes, parse and validate unknown input, await the callback, and reject errors without unhandled promises.
4. Use source timestamps and complete event transitions, preserving a single snapshot per entity. Prefer Linear state semantics over display names.
5. Run `npm run test:run -- src/providers` and inspect output for warnings and unhandled rejections.

## Task 3: Snapshot ordering and rule selection

Files: `src/store/sqlite.ts`, `src/store/sqlite.test.ts`, `src/engine/rules.ts`, `src/engine/rules.test.ts`.

1. Add failing SQLite tests for delayed/repeated delivery and tombstones, and engine tests for equal-priority events and deterministic ties.
2. Reject stale snapshot updates using source version dates and preserve stable creation timestamps. Migrate existing timestamp provenance without deleting data. Sort rule candidates by descending update timestamp and ascending ID.
3. Run the store and engine tests. Retain parameterized SQL and real SQLite tests.

## Task 4: Slack delivery and HTTP integration

Files: `src/slack/client.ts`, `src/slack/client.test.ts`, `src/server.ts`, `src/server.test.ts`, `src/integration.test.ts`, `src/index.ts`; a synchronization module/test and local HTTP fixture as needed.

1. Use test-writer instructions to add failing tests for delivery ordering, failed-write recovery, deduplication, startup recovery, close behavior, debug authorization and accurate diagnostics.
2. Implement one serialized delivery path that recalculates the desired status from persisted snapshots, catches SDK failures, and retries the latest state on a bounded interval. Invalidate deduplication after uncertain writes and respect Retry-After. Limit SDK request duration with an absolute cancellation deadline and no SDK retries so recovery and shutdown terminate.
3. Validate normalized events before persisting them. Disable `/status` without a token; verify bearer tokens without exposing secrets.
4. Replace the false-positive integration test with contract integration tests using the real SDK and a local HTTP API. Capture expected errors and block unintended external HTTP in tests.
5. Add graceful signal handling, run all tests and build, and verify no pending timers or network errors remain.

## Task 5: Runtime, dependencies, operation and documentation

Files: `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.json`, CI workflows, `Dockerfile`, `docker-compose.yml`, `README.md`, example configuration.

1. Pin supported development runtime to Node 22. Update dependencies within supported major versions first; investigate any remaining advisories without force-upgrading across majors.
2. Exclude tests from production build and validate the Docker production installation/build.
3. Document configuration changes, debug authentication, real supported transitions, source ordering, delivery semantics, health/status limitations and test commands.
4. Run `npm ci`, `npm run build`, `npm run test:run`, `npm audit --omit=dev`, `git diff --check`, and Docker build/smoke checks where available.
5. Request independent code review against this plan, address findings, rerun affected checks, and commit in conventional commits under 72 characters without attribution.

## Validation record

- Configuration: 19 initial regression failures before implementation; 23 tests pass, including literal environment values and YAML placeholder preservation.
- Providers: 45 initial failures and two unhandled rejections before implementation; 66 tests pass with raw signatures, schema validation, timestamps and lifecycle transitions.
- Store/rules: stale versions, deterministic selection, equal-timestamp tombstones and existing-database migration were each observed failing before their fixes. The migration preserves data and its provenance marker survives reopening.
- Slack delivery: the contract suite observed premature responses, unordered writes and missing acknowledgements before fixes. It now verifies serialized writes, durable acceptance, retries of the latest state, rate-limit cooldowns, uncertain-write cache invalidation, restart recovery, debug authorization and graceful close.
- Absolute deadline: the SDK inactivity-timeout baseline remained active for 604 ms against a 100 ms timeout while bytes kept arriving. Absolute cancellation passes the less-than-400 ms assertion.
- Final verification on Node 22.23.3: `npm run typecheck`, `npm run build`, and `npm run test:run` passed; 144 tests across 12 files, with no unhandled rejections or uncaptured network warnings.
- `npm audit` reports zero vulnerabilities across production and development dependencies. Production majors were retained; Vitest moved from 2 to 5 to resolve development advisories.
- Docker linux/amd64 build passed with locked `npm ci` and production dependency pruning. Smoke verification ran without external networking: health 200, unauthorized diagnostics 401, authorized diagnostics 200, UID 1001, no test artifacts or Vitest in the image, and SIGTERM exit code 0.
- `docker compose config --quiet` and `git diff --check` passed.
- Independent plan-compliance review passed. Quality review found three additional bugs (timestamp provenance on upgrade, literal environment fallback and total request deadlines); all received regression tests, fixes and an approved follow-up review.
- Tests verify the Slack HTTP contract locally. No live Slack credentials or remote profile changes were used. Snapshot/backfill and multi-review aggregation limitations are documented in README.
