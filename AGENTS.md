# Repository rules for code agents

## Scope and Git hygiene
- Allowed Git commands are limited to `git status`, `git log`, and explicitly requested `git pull --ff-only`. Pull can advance the local branch; never run it automatically, create a merge commit, or rebase on divergence.
- Never run `git commit` or `git push`. Do not stage/unstage files, create/switch/delete branches, reset, merge, rebase, amend, tag, or otherwise create/rewrite history or publish code. Do not bypass these restrictions through aliases, scripts, tools, APIs, or direct `.git` edits. The user handles staging, commits, and pushes.
- Follow `.gitignore` first: normal searches must respect it; never force-add ignored files or change ignore rules to include generated files, caches, credentials, or tool scratch.
- Inspect `git status --short` before editing; preserve unrelated user changes and keep the diff limited to the prompt.
- Focus on the Expo app in `frontend/` and Go backend in `backend/`. Defer `frontend-web/` work until the user explicitly starts the web phase or requests a specific web change; do not infer readiness yourself.
- Do not change databases, toolchain versions, or deferred web code merely to make an unrelated task pass.

## Database boundary
- Do not mutate any connected database (schema, rows, roles, permissions, seeds, resets) unless the user explicitly authorizes that execution and target in the prompt/session.
- A request for a feature or schema change permits preparing necessary migration files, not executing them. The user reviews and runs migrations by default.
- Add a new ordered SQL migration in `backend/migrations/`; do not rewrite historical migrations or use `init_all.sql` as an incremental update.
- Supply purpose, affected objects/data, prerequisites, rollout order, verification SQL, and rollback/recovery notes for review. Never claim a migration was applied unless it was.
- Do not run migration/bootstrap/seed tools, live write APIs, or database-writing integration tests under the label of validation without execution authorization. Inspect side effects first; prefer mocks for tests.
- The Go migrator defaults to `up` when no argument is given. Preparing SQL does not authorize running that command.

## Package manager and versions
- Use npm and the existing `package-lock.json` for Expo; use `backend/go.mod` and `go.sum` for Go. Do not introduce another package manager or lockfile.
- Preserve the existing Go, Node, npm, Expo SDK, React Native, React, and library versions unless the user explicitly requests a version change. Keep one consistent toolchain per component/environment; do not switch versions mid-task.
- Use installed project-local tooling. No global Expo CLI, `@latest`, automatic SDK repair, `npm update`, `npm audit fix`, `go get -u`, or implicit toolchain downloads as a workaround.
- Restore JS dependencies with `npm ci` only when needed; inspect lifecycle scripts first. Do not regenerate lockfiles, widen ranges, add dependencies, or alter build images unless explicitly authorized.
- Before toolchain-dependent work, check relevant versions once against the manifests and [toolchain notes](docs/agent-context.md). Report mismatches; do not silently reconcile them. If blocked, finish independent work and explain the exact missing decision.

## Architecture and design maintenance
- Treat [system.md](docs/voice-architecture/system.md) as the canonical voice-system architecture; `frontend/design.md` is the Expo UI design brief, not a second system specification.
- Every architecture change must update `system.md` and affected flow/protocol/security/deployment/decision documents in the same change. This includes component boundaries, APIs/events, authentication, persistence, call states, media routing, encryption, privacy, and runtime topology.
- Keep diagrams consistent with prose; distinguish proposed, implemented, and verified behavior. Update `frontend/design.md` when changing its UI requirements; update the context map when ownership/entry points change.
- Keep `source-notes.md` as the unchanged historical input. Document evolved decisions in the maintained design files instead.
- Before completion, identify the docs updated or state why there was no architectural impact. Do not generate duplicate design documents or append routine task logs to agent instructions.

## Context-efficient workflow
- Read this file, then only relevant rows/sections in [agent-context.md](docs/agent-context.md); follow any applicable nested `AGENTS.md`.
- Translate the prompt into acceptance criteria and impacted components. For nontrivial work, give a short plan; proceed with authorized work without repeated permission requests.
- Use scoped `rg --files` and `rg -n` searches, then read matching functions and their direct callers/contracts/tests. Do not dump the repository, entire lockfiles, or unrelated docs into context.
- Skip ignored/generated folders, the deferred web app, and historical migrations unless directly relevant. Inspect ignored config only when necessary and authorized; never print secrets. Batch independent reads and retain concise findings instead of rereading.
- Trace one affected flow end to end, reuse existing modules/patterns, and make the smallest complete change. Avoid speculative abstractions, broad refactors, unrelated formatting, or new infrastructure.
- Handle loading, empty, error, cancellation, and cleanup behavior where the change needs them; preserve authorization, API compatibility, and resource limits.
- Validate the changed behavior, update affected docs, and review the final diff. Report outcome, checks, limitations, pending migrations, and architectural impact concisely.

## Feature verification gate (before staging or committing)
- For every feature or bug fix, add or update tests for its acceptance criteria: verify outcomes and data/state changes, plus relevant error, boundary, or regression cases. Run the focused checks and the applicable [disposable testing workflow](docs/voice-architecture/testing-runbook.md#feature-verification-gate); a passing smoke check does not replace a feature-specific test.
- Use the disposable Docker integration harness for backend changes and the USB device workflow for Android native or mobile-to-backend behavior. For client-only logic or UI with no native/backend impact, run focused Expo tests and typecheck and state why the live workflows do not apply. Docs-only changes need documentation checks, not live workflows.
- Keep the database boundary above: get explicit execution authorization for the disposable target or give the operator the exact commands for a user-run check. Failures, missing feature coverage, unavailable prerequisites, and unconfirmed required runs block readiness; report what remains, then verify the final candidate before recommending staging or committing. The user alone stages and commits.

## File-scoped commands
- From `frontend/`: `npm test -- --runTestsByPath src/path/to/file.test.ts --runInBand` for a relevant existing/new test; `npm run typecheck` for project-aware TypeScript checking.
- From `backend/`: `go test ./internal/<package> -run <TestName>` for focused tests; `gofmt -w <changed.go>` for changed Go files only. Use the approved existing toolchain; do not auto-fetch another one.
- Inspect tests for external side effects before running them. Broaden checks only for shared-contract changes, failures, or repository requirements; documentation-only edits need link/diff checks, not app/database startup.
- Existing Makefile/Docker scripts contain stale frontend assumptions; do not assume they are valid Expo checks. See context notes before invoking build/start scripts.

