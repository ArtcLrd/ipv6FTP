# Project context: read only the relevant sections

The root [AGENTS.md](../AGENTS.md) contains the repository rules. This file is a navigation map, not a duplicate architecture or task journal. Update it when entry points, component ownership, or approved toolchain choices change.

## Current phase

Active development targets the **Expo / React Native app** in `frontend/` and the **Go backend** in `backend/`. The separate `frontend-web/` app is deferred until the user explicitly starts that phase. Preserve it without routine exploration, testing, or synchronized feature work.

The [system overview](voice-architecture/system.md) is canonical. [Call implementation proposed V2](voice-architecture/call_implementation_proposed_v2.md) owns the accepted calling plan, detailed flows, provisional defaults, integration phases and acceptance criteria; it supersedes the initial [call proposal](voice-architecture/call-peer-connection.md). [Session V2](voice-architecture/session-management-proposed-v2.md) owns accepted user/device enrollment, persistence/recovery, guest weekly policy/gates/reminders, per-API rates, concurrency, retention and validation; it supersedes initial session research and preserves calling V2 integration. The [September baseline](voice-architecture/current-implementation.md) is historical WebRTC/guest/contact code; newer working-tree code contains partial registered-only Android native Noise/direct-IPv6 calling. Distinguish proposal, source implementation and runtime verification. The [UI brief](../frontend/design.md) remains separate.

## Find the affected flow

For the next user-management implementation, start with [the consolidated execution plan](voice-architecture/user-management-implementation-plan.md): it records D01-D17, account-module ownership, phased contracts and validation. It incorporates identity/session prerequisites now and reserves actual call-bound accounting/media verification for Calling V2 integration. [Contracts v2 draft](voice-architecture/user-management-contracts-v2.md) holds the M0 contract freeze and open decisions. It is a plan, not current implementation evidence; preserve the invariants in Session V2 and the canonical system overview.

Paths in this table are repository-relative. Start with the relevant row, then follow actual imports and callers rather than reading every listed area.

| Request concerns | Start here | Follow only as needed |
| --- | --- | --- |
| App startup/session restoration | `frontend/App.tsx`, `frontend/src/app/bootstrap.ts` | `app/providers.tsx`, `app/AppShell.tsx`, `services/authService.ts` |
| Screens/navigation | `frontend/src/pages/`, `frontend/src/navigation/index.tsx` | Existing components, `theme/`, `frontend/design.md` |
| Login/authentication | `frontend/src/modules/auth/`, `frontend/src/services/authService.ts` | Backend `handlers/handlers.go`, `service/service.go`, `repository/identity_repo.go`, middleware/security |
| Contacts/user discovery | `frontend/src/modules/contacts/`, `modules/user/`, `modules/phonebook/` | Backend routes, service/repository methods, realtime events |
| Call setup/media/lifecycle | `frontend/src/modules/call/nativeVoice.ts`, `api.ts`, `store.ts`, `types.ts` | `NativeCallPage.tsx`, local `frontend/modules/voice-engine/`, backend `*_v2.go` call handler/service/repository, `realtime/call_signal.go` and `rendezvous.go`; historical WebRTC code is not the V2 fallback |
| Signaling/presence | `frontend/src/realtime/`, `frontend/src/services/signalingService.ts` | Backend `internal/realtime/`, route auth, message types |
| API/errors/token handling | `frontend/src/core/api/`, `core/storage/secure.ts` | Matching module API/types and backend route/handler |
| Runtime/network configuration | `frontend/src/config/env.ts`, `frontend/src/services/networkService.ts` | Native `DirectTransport.kt`, `frontend/app.json`, backend `internal/config/config.go`; TURN is outside first V2 scope |
| Backend startup/dependencies | `backend/cmd/api/main.go`, `backend/internal/bootstrap/app.go` | Config, repository pool/cache construction, router |
| HTTP contract/permissions | `backend/internal/transport/http/router.go` | `handlers/`, `middleware/`, `rbac/`, `service/` |
| Business rules/persistence | `backend/internal/service/`, `backend/internal/repository/` | Models and the relevant SQL definitions in migrations |
| Database schema change | Matching repository query/function and `backend/migrations/` filenames | Relevant SQL only; `backend/cmd/migrate/main.go` for runner behavior |
| Registered enrollment and cutover | `backend/internal/service/auth_v2.go`, Expo auth module, Android voice engine | [Migration 018 and cutover review](voice-architecture/migration-018-review.md) |
| Regression coverage | Nearest `*_test.go` or `__tests__/` | Test setup and direct dependencies; inspect side effects |

Frontend paths abbreviated after the first entry are relative to `frontend/src/`. Backend handler/service/repository paths are under `backend/internal/` unless otherwise shown. Check current source before assuming an API or event name.

Typical API flow: `screen -> module hook/store/API -> core API client -> Go router/middleware -> handler -> service -> repository -> database`. Realtime and voice media have their own paths; follow their managers/handlers and consult the architecture only as needed.

## Read the right design document

| Impact | Documents to inspect/update |
| --- | --- |
| Proposed calling journeys, protocol defaults and validation | [call_implementation_proposed_v2.md](voice-architecture/call_implementation_proposed_v2.md), system overview and affected detailed documents |
| User/session prerequisites and historical source evidence | [session-management-proposed-v2.md](voice-architecture/session-management-proposed-v2.md); initial [session-management.md](voice-architecture/session-management.md) is superseded; [current-implementation.md](voice-architecture/current-implementation.md) is the September baseline, not current verification |
| Components, ownership, trust/data boundaries | [system.md](voice-architecture/system.md) |
| Setup, lifecycle, media, recovery, teardown | [flows.md](voice-architecture/flows.md), plus system overview |
| State machine, frame/contract semantics | [protocol.md](voice-architecture/protocol.md), affected flows/system overview |
| Identity, permissions, encryption, privacy | [security.md](voice-architecture/security.md), affected protocol/flows/system overview |
| Service topology, operational requirements | [deployment.md](voice-architecture/deployment.md), system overview |
| Resolved design choices or changed acceptance criteria | [decisions.md](voice-architecture/decisions.md) |
| Expo UI requirements | [frontend/design.md](../frontend/design.md) |

Update docs in the same change as code. A refactor with no externally visible behavior or architectural change needs a brief final note, not artificial documentation churn. Preserve [source-notes.md](voice-architecture/source-notes.md) as historical input.

## Toolchain baseline and known mismatches

Observed on 2026-09-19. Manifests and lockfiles remain authoritative for dependencies; the host observations below are not new approved project pins.

| Tool/component | Repository declaration | Observed local state / policy |
| --- | --- | --- |
| Go | `backend/go.mod`: `go 1.25.0`; Docker: `golang:1.25-alpine` | Host reports `go1.26.1`; mismatch recorded, not resolved |
| Node | No project-wide exact pin; Docker uses `node:22-alpine` | Host reports `v22.23.1`; preserve environment, do not choose another version |
| npm | Existing npm lockfiles; no explicit `packageManager` pin | Host reports `10.9.8`; use npm consistently, no switch to Yarn/pnpm/Bun |
| Expo | `frontend/package.json`: `~54.0.35` | Mobile lockfile resolves `54.0.35`; use project-local Expo |
| React / React Native | Mobile manifest: `19.1.0` / `0.81.5` | Preserve current manifests and resolved dependency graph |

The Go directive is a language/minimum-toolchain declaration, not an exact compiler pin. Docker tags above are also not exact patch pins. Do not claim this repository already has a fully pinned cross-machine toolchain. Selecting/reconciling exact project-wide versions is a separate explicitly authorized change; do not silently downgrade the host or upgrade the project.

For toolchain-dependent work, compare relevant runtime versions once. Reuse an available approved environment; prevent automatic Go toolchain switching/downloads (for example, process-local `GOTOOLCHAIN=local` when appropriate). If the required approved compiler is unavailable, report that limitation instead of installing one implicitly. Version/dependency changes require explicit user direction, even when a doctor/linter/build tool suggests them.

Lockfiles should be queried for individual packages, not dumped into context. `npm ci` restores the locked graph and may run lifecycle scripts; inspect scripts before use. Avoid bare `npx` commands that may fetch missing tools and avoid remote build/submission commands as routine validation.

## Commands and existing caveats

| Task | Working directory | Command / boundary |
| --- | --- | --- |
| One mobile test | `frontend/` | `npm test -- --runTestsByPath src/path/to/file.test.ts --runInBand` |
| Mobile type check | `frontend/` | `npm run typecheck`; do not pass individual files and bypass `tsconfig.json` |
| One Go test/package | `backend/` | `go test ./internal/<package> -run <TestName>` with the approved toolchain |
| Format changed Go source | `backend/` | `gofmt -w <changed.go>` |
| Mobile dev server, only when useful to the task | `frontend/` | `npm start`; review environment/endpoints before exercising flows |
| Migration execution | `backend/` | User-run after review; not part of ordinary agent validation |

The mobile manifest advertises lint/format checks, but no mobile ESLint/Prettier config was found in the inspected tree. Verify installed tools and current configs before treating those scripts as working checks; do not install or upgrade tools just to silence failure.

Root `Makefile` and `Dockerfile` reference `frontend` scripts such as `build`/`dev` that are absent from the current Expo manifest. Do not use them as validated Expo workflows or repair them as an unrelated side task. `frontend/app.json` configures a native WebRTC plugin; the app explicitly handles a missing native WebRTC module, so an Expo Go launch alone cannot verify calling behavior.

Starting the backend connects to configured PostgreSQL/cache services. Runtime API calls and integration tests may write data even if their purpose is verification; use inspected mocks or explicitly authorized test targets.

## Database change handoff

When the requested feature needs a schema/data change, prepare files without applying them:

1. Inspect relevant repository calls and migration filenames; choose the next unused consistently padded numeric prefix for `<number>_<description>.sql`.
2. Add a new migration; preserve prior files. The runner records checksums and rejects changed historical migrations. It skips `init_all.sql` and sorts versions lexically.
3. Include review notes beside the migration or in a linked review document: purpose, affected objects/rows, dependencies, permissions, locks/data-loss risks if applicable, deployment ordering, verification queries, and rollback/recovery constraints.
4. Distinguish migration files prepared, SQL reviewed, and execution verified. Report the user-run step and any feature dependency on the unapplied migration.
5. Never apply, reset, seed, or mutate a connected database unless the user explicitly authorizes execution for that target. Mentioning a database feature is not permission to execute a migration.

`backend/cmd/migrate/main.go` defaults to `up` without arguments. The PowerShell wrapper defaults to `status`; inspect the current implementation before assuming any command is read-only. Avoid connecting to live infrastructure when source inspection suffices.

## Efficient completion check

- Requested behavior is implemented within Expo/Go scope; unrelated files and existing user changes are preserved.
- Focused verification passes, or an exact pre-existing/environmental blocker is recorded without unauthorized dependency or database changes.
- Necessary migration files and review notes exist; execution status is explicit.
- Architecture/UI/context documents are updated where affected, with proposals distinguished from verified code behavior.
- Final diff has no credentials, generated files, accidental lockfile churn, or incidental version changes.
