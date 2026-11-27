# Disposable backend testing runbook

This is the operator walkthrough for the implemented disposable Docker integration-test and physical Android-device workflows. It is not an application/deployment specification and does not authorize use of a host, shared, production, or persistent database.

## Status and evidence

Keep these evidence levels distinct:

- **Implemented:** `backend/scripts/test-integration-docker.sh` creates a uniquely named Compose project, checks for pre-existing project-labeled containers/networks/volumes before arming cleanup, generates per-run credentials, and runs the containerized Go integration runner. PostgreSQL data is in container tmpfs. The wrapper removes only that project's Compose resources on exit/signals. The test runner creates and migrates a disposable database inside that fresh PostgreSQL container, runs its selected tests, then removes the owned test database.
- **Verified integration run (2026-11-24):** the operator ran the default harness against a fresh Docker PostgreSQL 18.4 instance; migrations 001–020 replayed. The three Critical/High registry tests passed (`selected=3 passed=3`): `TestPostgresRegisteredEnrollment` (including subtests), `TestPostgresAccountEventIsolationAndRollback`, and `TestPostgresEventStreamIsolationReplayAndExpiry`. Exact-project container/network checks found no leftovers after teardown. This is not evidence that the entire integration suite or production is ready.
- **Offline-only safety verification:** shell test scripts use fake Docker tools to check collision refusal and selected failure/signal cleanup paths. No live Docker collision/interruption test has been verified. The PowerShell pair is a separate offline safety model only; it does not execute integration tests, connect to PostgreSQL, or provide an alternate runner.
- **Verified baseline generation (2026-11-24):** on a separate authorized fresh Compose project, migrations 001–020 replayed, restore parity passed, and `backend/db/schema/baseline.sql` was generated. It was 41,822 bytes with SHA-256 `2c484bf042212151b7da1ab23a55791e993a255f9499ea71e9d30c6523a8703a`. Exact-project Docker checks found no leftovers.
- **Verified physical-device smoke test (operator-reported, 2026-11-27):** a USB-connected physical Android device on API 30 passed helper preflight, the phone browser received `status: ok`, and native instrumentation reported 5 tests with `BUILD SUCCESSFUL` (Gradle 8.14.3). The operator reports host health success, cleanup of the disposable backend, and no remaining `adb reverse` entries. The captured backend log shows migrations 001–020 and HTTP 200 health responses, but does not include a separate post-cleanup Docker label query. The final tunnel state does not prove whether teardown removed a mapping or none existed. This does not verify a call or full app journey.
- **Historical/proposed guidance:** earlier drafts described testcontainers, a shared host test server with manually separated roles, per-test database cloning, fixture frameworks and a future `-tiers` command. These are not the current operator workflow. Do not treat them as implemented, authorized, or verified behavior.

## Safety boundary

- Use only the supplied Docker harnesses, which create fresh, disposable PostgreSQL containers. **Never use host PostgreSQL, a shared cluster, an application `.env`/DSN, a persistent database, or a manually selected database.** A database name, marker, or role name alone is not proof of isolation.
- Do not run the migrator, bootstrap scripts, or schema-baseline command directly against any other database. Migration 014 is destructive; the harness invokes migrations only inside its fresh disposable container.
- Never run broad Docker prune commands. Inspect any suspected leftovers using the exact project name printed by the harness and ask the operator to review before cleanup.
- The generated schema baseline is a reference artifact, **not** a migration-ledger bootstrap. Ordered migrations remain the sole authority for upgrades. Do not initialize a database from the baseline and claim migration versions/checksums that were not applied.
- Do not wipe Android app data. The device helper supports only authorized USB-connected physical phones and uses `adb reverse` for host connectivity; it does not permit emulator/wireless targets.
- Treat all outputs as potentially sensitive. Do not publish generated credentials, tokens, or connection strings.

## Backend integration tests

### Prerequisites

Use Bash (for example Git Bash on Windows) and Docker Desktop with Docker Compose available. The integration image uses Go 1.25 and PostgreSQL client utilities; PostgreSQL 18.4 is the Compose database image. No host PostgreSQL installation or database role setup is part of this workflow.

### Run the default Critical/High selection

From `backend/`:

```bash
sh scripts/test-integration-docker.sh
```

The wrapper chooses a random project suffix. Leave the command running until the runner exits. It returns a nonzero status on failure and runs scoped Compose cleanup on exit, including its handled HUP/INT/TERM paths. On success, review the final selected/passed count and test output.

The registry at `backend/testdata/integration-tiers.json` currently contains:

| Tier | Registered test |
| --- | --- |
| Critical | `internal/repository/accountsec`: `TestPostgresRegisteredEnrollment` |
| High | `internal/repository/accountsec`: `TestPostgresAccountEventIsolationAndRollback` |
| High | `internal/transport/http/handlers`: `TestPostgresEventStreamIsolationReplayAndExpiry` |

The Go runner defaults to `Critical,High` and its parser supports `-tiers Critical`, `-tiers High,Medium`, or `-tiers All`. However, the host Bash script runs `docker compose ... run ... runner` without forwarding its own arguments. **Do not append `-tiers` to the documented Bash command or imply that this wrapper supports tier overrides.** The runner's selection support is implemented, but no supported host invocation for overriding tiers is exposed by this wrapper. Updating the wrapper is a separate code change.

### Generate the schema reference (intentional artifact write)

Only regenerate when explicitly authorized to update the reference artifact. Run from `backend/`; this uses the same fresh disposable Compose harness, not a host database:

```bash
IPV6FTP_SCHEMA_BASELINE_MODE=1 \
IPV6FTP_SCHEMA_BASELINE_CONFIRM=generate-disposable-schema-baseline \
sh scripts/test-integration-docker.sh
```

The baseline runner applies ordered migrations to a fresh source fixture, dumps schema only, restores it transactionally into a separately provisioned fresh restore fixture (leaving PostgreSQL's default `public` schema intact), compares normalized dumps including ACLs/comments while excluding ownership and row data, and atomically publishes only after parity succeeds. Output is restricted to `backend/db/schema/baseline.sql`. Normal harness mode does not regenerate the baseline.

The source, restore and baseline artifacts do not replace the ordered migration history or initialize the migrator ledger. Never run `cmd/schema-baseline` directly against a chosen database. If generation or parity fails, retain the output and stop; do not try another target or overwrite the artifact manually.

### Troubleshooting and cleanup

- **Collision refusal:** the script checks exact Compose project labels before cleanup is armed. A collision exits without Compose mutation. Do not reuse or force a project suffix.
- **Runner/migration/test failure:** retain the complete output and exit status. The harness attempts exact-project cleanup. If cleanup reports failure, note the printed `ipv6ftp-it-<hex>` project and inspect only that project's resources; do not prune globally.
- **Interruption:** signal cleanup is implemented in the Bash wrapper, but real Docker interruption/collision behavior has not been live-verified; only fake-CLI offline tests cover those branches. If real resources remain, stop and get operator review.
- Offline fake-Docker checks are available as `sh scripts/test-integration-docker.Tests.sh` from `backend/`. This does not start Docker or PostgreSQL.
- `backend/scripts/test-integration.ps1` and `backend/scripts/test-integration.Tests.ps1` are **offline-only safety helpers/tests**. The direct PowerShell entry point refuses integration execution; neither script connects to a database or runs Go integration tests.

## Physical Android device smoke test (Windows)

This checks the disposable API, USB reverse connectivity, and native module instrumentation only. It does not test account flows, calls, or the full app journey. The Expo app must be an installed development/native build that includes `frontend/modules/voice-engine`; Expo Go does not verify the module.

### Prerequisites

Install/configure prerequisites yourself; scripts do not install tools:

- JDK 17, with `JAVA_HOME` set and `java` available in Git Bash.
- Android SDK Platform 36, Build-Tools 36.0.0, Platform-Tools (`adb`), NDK 27.1.12297006, and compatible CMake; set `ANDROID_HOME` and put `platform-tools` on `PATH`.
- Gradle 8.14.3 through the checked-in wrapper; do not install global Gradle.
- Node 22.x/npm 10.x with the existing Expo 54.0.35 lockfile/dependencies.
- A USB-connected physical Android phone on API 29 or later, Developer Options and USB debugging enabled, unlocked, with the RSA prompt accepted. Install the manufacturer's ADB driver if needed.
- On Windows, set `GRADLE_USER_HOME` to a short writable path such as `C:\g` to avoid native build path-length issues.

Read-only checks:

```bash
java -version
adb version
adb devices -l
```

The phone must show state `device`, not `unauthorized` or `offline`. If more than one authorized device is attached, select the intended serial with `export ANDROID_SERIAL=YOUR_DEVICE_SERIAL`.

### Start disposable backend (Terminal 1)

From `backend/` in Git Bash:

```bash
sh scripts/test-device-docker.sh
```

This starts a fresh Compose project (`ipv6ftp-dev-<hex>`) with PostgreSQL in tmpfs, applies ordered migrations to its disposable database, and runs the API on host loopback port 8080. It does not use host/shared PostgreSQL. Wait for `ipv6FTP server starting on :8080`; keep Terminal 1 open. The script stops/removes only its Compose project on exit/signals. Press Ctrl+C once after device verification. If cleanup fails, record the exact project name and inspect only its labeled resources; never run `docker system prune`.

### Check/connect/test (Terminal 2)

From `frontend/`, select the phone and run the preflight:

```bash
sh scripts/android-device.sh check
```

The helper rejects emulator, wireless, unauthorized and offline targets, including a bad `ANDROID_SERIAL`; it verifies API 29 or later. Then check the disposable API from the host:

```bash
curl --fail --show-error http://127.0.0.1:8080/healthz
```

After that succeeds, establish the USB reverse and verify it from the phone browser:

```bash
sh scripts/android-device.sh connect
```

Open `http://127.0.0.1:8080/healthz` on the phone. Do not substitute a Wi-Fi/LAN URL. The helper refuses conflicting `tcp:8080` reverse mappings.

Run native instrumentation:

```bash
sh scripts/android-device.sh module-tests
```

This runs `:ipv6ftp-voice-engine:connectedDebugAndroidTest` through `frontend/android/gradlew`. Record serial, API level, test count, and full result. A successful instrumentation run is not proof that calls work.

### Teardown

From `frontend/`, remove only the exact helper-owned host/device port-8080 reverse mapping:

```bash
sh scripts/android-device.sh teardown
adb -s YOUR_DEVICE_SERIAL reverse --list
```

No exact `tcp:8080 tcp:8080` mapping should remain; unrelated mappings are preserved. The helper does not clear app data and has no `wipe-data` action.

Then press Ctrl+C once in Terminal 1 and wait for Compose cleanup. If needed, inspect only the printed project's resources by exact label, substituting its full name:

```bash
docker ps -a --filter label=com.docker.compose.project=ipv6ftp-dev-EXACT_HEX
docker network ls --filter label=com.docker.compose.project=ipv6ftp-dev-EXACT_HEX
docker volume ls --filter label=com.docker.compose.project=ipv6ftp-dev-EXACT_HEX
```

Offline helper tests use fake `adb`, Gradle, and npm tools only:

```bash
sh scripts/android-device.Tests.sh
```

This is not a device test. The Android helper's USB reverse is intentional; do not use `adb reverse --remove-all` or broad device cleanup.

## Results to report

Report the exact harness/device commands, test selection/count, host and phone health results (for device runs), test/build outcome, and teardown result. State whether checks were offline, operator-reported live, or live-verified. For backend Docker runs, include the exact Compose project identifier and exact-label cleanup evidence when collected. For device runs, include device serial (redacted if desired), API level, and whether the reverse mapping remained after teardown. Do not include generated passwords, tokens, or DSNs.
