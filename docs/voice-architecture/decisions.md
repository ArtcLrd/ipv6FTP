# Decisions and implementation checklist

## Enrollment handshake decisions, 2026-11-01

The user selected the following enrollment decisions while resolving the M2 contract prerequisites.

- **Profile:** `Noise_IK_25519_ChaChaPoly_SHA256`, matching the hash/cipher of the peer-call profile in `NoiseSession.kt` (`Noise_XX_25519_ChaChaPoly_SHA256`). BLAKE2s was considered and rejected for consistency.
- **Go side:** implemented in-house in `backend/internal/noiseik` on the already pinned `golang.org/x/crypto` and the standard library; no new dependency. It reproduces the official noise-c vector byte for byte (`backend/testdata/noise`). No cross-run against noise-java on a phone has happened yet.
- **Replay/purpose separation:** IK has no replay protection, so each handshake binds a purpose label and a fresh server challenge into the prologue (`noiseik.Prologue`).
- **Server key bootstrap:** the phone fetches the server static key from an authenticated bootstrap/config endpoint over TLS and pins it on first fetch; the authenticated enrollment finish establishes a separate P-256 signer pin. The client uses that pin to verify an increasing rotation epoch and each successor X25519 key. Native and deployment verification remain pending.
- **v1 transition:** v1 login/register keep working until cutover; credential issuance is disabled only then.

## Target New Flow (To Be Implemented)

The consolidated decisions below come from the accepted Calling V2, Session V2, and account plan. D01–D17 remain the user-selected account decisions. Proposed numerical defaults, draft contract prerequisites, and unchecked acceptance cases require verification. The enrollment decision above resolves the profile, library and trust choices where older draft wording still lists them as open.

## Calling V2

### 20. Defaults and deadline precedence

All numerical values below are **accepted provisional test defaults**, not measurements, formal security bounds or permanent product promises.

| Parameter | Starting default |
| --- | --- |
| Protected UDP header / tag | 38 / 16 bytes |
| Maximum UDP payload | 1,200 bytes including header/tag |
| Security sequence / replay window | 64-bit per direction/key / 1,024 numbers |
| Control operation / path challenge | 128-bit random ID / 256-bit random challenge |
| Verification | Full 256-bit completed-handshake fingerprint; link/QR |
| Codec | Mono speech Opus; 48 kHz codec timeline; 20 ms frames |
| Bitrate | Start 24; negotiated test range 12-32 kbit/s |
| Playback buffer | Start 40 ms; adaptive target 20-120 ms |
| Waiting send queue | Two frames, nominal 40 ms |
| Feedback | 25 received audio packets or 500 ms, whichever first |
| FEC observations | Five seconds; enable candidate >=3% with headroom; retain between 1-3%; disable after <1% for 10 seconds |
| Experimental bitrate changes | Down 20%; up 10% after 10 seconds stability, then observe |
| Unused code/link invitation | 10 minutes |
| Direct ringing / code-join approval | 30 seconds each |
| Mutual preparation/readiness | 10 seconds after acceptance |
| Noise handshake | 15 seconds after mutual readiness |
| Human verification | Two minutes after verification is available |
| Rendezvous registration | 10 seconds |
| Bidirectional validation / migration attempt | 10 seconds |
| Initial setup overall | Three minutes after participation accepted |
| Peer challenge / suspicion / recovery entry | About 2 / 3 / 6 seconds, accounting for measured RTT and network loss |
| Recovery episode | 20 seconds total; at most three coordinated attempts |
| Stability before fresh recovery budget | 10 seconds bidirectional stability |
| Authorization / renewal / extra grace | 30 / 10 / 0 seconds |
| Scheduled key renewal / hard key age | Begin 45 minutes / stop old key at 60 minutes |
| Allocated packet hard limit | 2^20 per direction/key; renew early enough |
| Essential-control timeout | Start 500 ms; adaptive 250 ms-2 seconds, backoff |
| Essential transmissions | At most five including original, within stage budget |
| Old/new path or receive-key overlap | At most two seconds, further constrained by hard limits |
| Termination | Up to three transmissions within one second; media stops immediately |
| Candidate path amplification | At most 3x authenticated bytes received before validation; additional bounded rates |

Precedence: explicit end/revocation/denial wins; authorization and hard crypto limits are never extended by retry/recovery; stage deadlines fit inside initial/recovery episode deadlines; overlap never extends key lifetime; late callbacks cannot reset deadlines. Use monotonic local elapsed timing and server-authoritative invitation/authorization state, not synchronized phone wall clocks. Settings are versioned; a call uses negotiated/issued rules, not arbitrary mid-call server config changes.

### 22. Acceptance and security validation

| Test family | Required scenarios and outcome |
| --- | --- |
| Entry and consent | Registered direct, unknown request, guest/guest and mixed code/link; approved recipient only, no automatic microphone or endpoint disclosure |
| Invitation races | Concurrent joins, crossed invites, cancel/accept/expiry, busy and device replacement; one valid result, no leaked slots or revived calls |
| Trust | First QR/link, remembered key, new phone, changed/revoked key, no independent channel, stale URL; correct trust gate, no silent replacement |
| Handshake | Wrong key/context/roles/version, duplicates, ordering, timeout, oversized input; no weaker fallback or double advancement |
| Packet boundary | Tampering, replay, reordering, reflection, forged high numbers, malformed authenticated codec/control payloads, concurrent arrival; bounded safe rejection and authentication before replay mutation |
| Ticket retry | Lost API/upgrade/UDP responses, concurrent consumption, changed endpoint, Redis loss; no duplicate effects or replay authorization |
| Audio | Mute, variable arrivals, random/burst loss, FEC absent/present, late originals, drift and congestion; no stale audio backlog or unlimited processing |
| Network | Wi-Fi/Ethernet, stationary/moving cellular, hotspot, one-/two-sided address change, one-way loss, IPv6 firewall failure; validated switch or bounded end |
| Long call | Renewal hard/soft limits, old/new overlap, lost promotion controls, repeated disruptions, midnight split; nonce safety and correct state/accounting |
| Authorization | Refresh, logout, old/new phone, suspension, allowance and backend outage; notification or lease-bounded stop, no recovery bypass |
| Crash/cleanup | Force-stop/uninstall, native failure, JS interruption, notification end, simultaneous ends; no capture/playback/socket/timer/service or durable-slot leak |
| Infrastructure | Cross-instance readiness, stale cache, PostgreSQL/Redis failure, lost outbox/PubSub delivery, reconnect races; authority/version checks preserved |
| Intervention | User end/block/report and per-call admin termination; authenticated scope, honest outcomes, no automatic blame from spoofed IP |

Use side-effect-free unit/mocked checks first. Real database/device integration requires an explicitly authorized test target. Test domestic and intercontinental routes plus controlled delay, loss, reordering, bandwidth reduction and handovers. Measure mouth-to-ear delay, actual traffic, underruns/late frames, recovery interruptions, CPU/memory/battery and resource limits. Investigate poor results rather than asserting smooth calling from bandwidth alone.

Security review includes maintained library selection, precise application profile and negative vectors, fuzzing/resource tests, and independent review before release claims. Strong primitives or one successful demo do not prove a secure application. No implementation or deployment verification is claimed by this plan.

### 23. Specification completion and deferred work

Accepted behavior above should not be reopened merely because byte-level work remains. Complete these before the affected phase ships:

- Exact CBOR arrays/types, numeric packet/control assignments, profile versions, canonical context, nonce encoding and unsigned-integer interoperability vectors.
- Explicit renewal/migration promotion, duplicate response, overlapping generation and UDP handshake retry state tables; preserve rollback/retirement and hard-limit safety under loss.
- Bounded operation-result storage, ticket TTL/processing/result retention, per-type message sizes, rate caps, invitation entropy and anti-amplification accounting.
- Approved libopus/Noise implementations, protected key storage and ABI/build compatibility without silently changing project versions.
- Measured/refined congestion control, FEC/PLC/drift behavior and provisional defaults.
- Unanswered non-ringing-request expiry, caller-approval management and allowance-warning presentation.
- [Session V2](flows.md) now owns accepted guest durations/reset assignments, recovery, recognition and session policies. Registered tier settings and exact accounting/configuration schemas remain separately configurable or prerequisite work.
- Admin roles, evidence/endpoint retention, broader abuse policy, platform-wide recovery and background push delivery remain separate work.

#### Reference basis

These explain primitives and design principles; they do not certify this application or imply adoption of another complete transport:

- [Noise Protocol Framework](https://noiseprotocol.org/noise.html): patterns, context, channel binding, explicit transport nonces and application responsibilities.
- [ChaCha20-Poly1305, RFC 8439](https://www.rfc-editor.org/rfc/rfc8439.html): AEAD and nonce requirements.
- [Deterministic CBOR, RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html#section-4.2): canonical structured encoding.
- [Replay window reference, RFC 6479](https://www.rfc-editor.org/rfc/rfc6479.html): bounded anti-replay principles.
- [Opus encoder controls](https://opus-codec.org/docs/opus_api-1.5/group__opus__encoderctls.html) and [decoder](https://opus-codec.org/docs/opus_api-1.5/group__opus__decoder.html): adaptation, FEC and PLC interfaces, not an approved version pin.
- [Opus transport guidance, RFC 7587](https://www.rfc-editor.org/rfc/rfc7587.html), [real-time congestion requirements, RFC 8836](https://www.rfc-editor.org/rfc/rfc8836.html), [UDP guidelines, RFC 8085](https://www.rfc-editor.org/rfc/rfc8085.html).
- [Android network state](https://developer.android.com/develop/connectivity/network-ops/reading-network-state), [IPv6 temporary addresses, RFC 8981](https://www.rfc-editor.org/rfc/rfc8981.html).
- [QUIC path validation, RFC 9000](https://www.rfc-editor.org/rfc/rfc9000.html#section-9): migration/anti-amplification reference only, not a QUIC implementation claim.
- [Redis Pub/Sub semantics](https://redis.io/docs/latest/develop/pubsub/#delivery-semantics): missed-notification limits.

## Session V2

### 20. Acceptance matrix

All scenarios require explicit outcome and no unauthorized side effects; a happy-path login test is insufficient.

| Area | Required scenarios and outcome |
| --- | --- |
| Entry/enrollment | Registered/guest, Skip, cancelled login, offline, duplicate/lost response, failed proof/storage; exactly one authorized outcome |
| Persistence | Process kill, reboot, locked storage, interrupted write, missing/corrupt credentials; no silent new guest |
| Recovery | Every section 6 row; revoked/blocked/converted/logged-out/replaced keys cannot recover |
| Recognition | Ordinary reinstall preserves matched bucket restrictions; spoof/missing/provider-version change never grants old identity/private data |
| Binding | Concurrent replacements, failed activation, shared/resold policy; one allowed current profile/active phone; no trust/call transfer |
| Authorization | Expiry/revoke, foreign IDs, modified local role/balance, stale socket/response; denial enforced backend |
| Refresh | Concurrent expired calls, rotation vs logout, response lost, late success and reuse; bounded retries and correct uncertain-session replacement |
| Allowance | Shared-bucket races, last seconds, concurrent reservations, service exhaustion and all-service gate; no double spend |
| Periods/policy | Monday UTC rollover, clock manipulation, boundary-spanning call, immediate/scheduled changes, cache lag; no erased usage/duplicate periods |
| Reminders | First UTC opening, every completed service, failed setup, overlap, retry/reconnect, lost ack; no active-service interruption |
| Events | Duplicate/out-of-order/missing events, old cursor, slow consumer, instance change; snapshot authority restored |
| Transactions | Multi-instance create/recovery/reserve/replace/end and worker races; all-or-nothing durable effects and safe bounded retry |
| Infrastructure | DB/Redis loss/restart, replica crash, outbox retry; no stale grant or local-memory security fallback |
| Rates | Independent limits by canonical API/method; UUID/query changes cannot bypass; login cannot consume renewal counter |
| Load | Reconnect/enrollment storms, hot records, slow clients; bounded resources and protected renewal capacity, no deadline extension |
| Cleanup/audit | Offline/notification logout, guest key removal, abandoned call expiry, retention races; no secrets/audio in logs |
| Integration | Physical registered/guest/mixed peers, quota stop/reset, replacement/revoke; V2 gates/leases/finalizer preserved |

Unit/mocked checks precede isolated integration; inspect external side effects. Database-writing tests require a separately authorized target. Native platform and physical two-device tests, realistic load and independent security review precede production/security claims. Report tested workload/hardware, limitations and failed scenarios, not universal capacity.

### 21. Specification prerequisites

These do not reopen accepted behavior; resolve them before the relevant phase ships:

1. Enrollment and guest recovery Noise IK application profile: exact messages/context/finish, pinned or otherwise authenticated server key, library compatibility, result recovery, vectors and failure bounds.
2. Typed endpoint/event/bootstrap schemas, ownership/generation fields, transition tables, error mappings, idempotency TTL/result-secret handling and socket revalidation contract.
3. Controlled account replacement/removal on shared/resold devices; guest reauthentication eligibility without bypassing explicit logout/revoke. Login-method and registered recovery details stay in their separate module.
4. Conversion entitlement mapping: preserve consumed usage while defining registered benefits and guest-bucket association; don't silently double-charge or erase history.
5. Policy effective transitions for issued auth credentials, active reservations and period/timezone changes; safe validated bounds and administrative authorization.
6. Retention inactivity definition, account/device deletion, current-period protection, keyed-recognition/provider rotation and specific audit categories/durations.
7. Concrete rate values per operation, socket budgets, pool/worker/queue limits, cleanup timing, supported workload/region/budget and measured service objectives.
8. iOS recognition/security integration and provider-specific migrations before an iOS phase; unsupported route/service implementations before enabling their allowance.

### 22. Decision register and evidence

Accepted decisions: authenticated guests; explicit Skip enrollment; UUID references; provider-independent recognition/identity; Android ANDROID_ID deterrence without IMEI/permanent tracking; one profile per recognized device and one active phone per account; shared guest allowance buckets; recovery matrix without guest codes; 15-minute access/absolute 30-day auth/no idle expiry; conservative uncertain-refresh recovery; per-service guest limits with all-enabled-service gate; Monday UTC weeks; daily/post-service coalesced reminders; DB-versioned policy with next-period default and explicit immediate option; immediate local logout/stop; versioned events/snapshot repair; PostgreSQL transactional authority; Redis temporary coordination/outbox; independent per-API rates; bounded capacity; configurable 90-day cleanup defaults; minimal audit and comprehensive validation.

Defaults and contracts are accepted design choices, not measured production guarantees. This document supersedes conflicting initial session research and supplies user-session policy deferred by calling V2; it does not replace calling V2's peer/media profile. Source notes remain unchanged.

Primary references used during the preceding research (reviewed in discussion; links are supporting evidence, not application certification):

- [Android identifiers](https://developer.android.com/identity/user-data-ids) and [ANDROID_ID](https://developer.android.com/reference/android/provider/Settings.Secure#ANDROID_ID): platform scope/reset limits.
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore) and [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/): protected storage considerations; verify the locked native package, no SDK upgrade implied.
- [Apple identifierForVendor](https://developer.apple.com/documentation/uikit/uidevice/identifierforvendor) and [DeviceCheck](https://developer.apple.com/documentation/DeviceCheck): why iOS reinstall recognition is separate work.
- [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) and [SQL injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html): request/resource checks and query boundaries.
- [RFC 9700 refresh replay defenses](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14): rotation principles; no claim this custom service is a complete OAuth server.
- [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html), [connection settings](https://www.postgresql.org/docs/current/runtime-config-connection.html) and [Redis Pub/Sub](https://redis.io/docs/latest/develop/pubsub/): concurrency/resource and missed-notification boundaries.

## Account management

### 1. Outcome and boundaries

Complete registered and guest account journeys in the Expo Android app and Go backend, including interruption, concurrency, abuse and recovery behavior. Incorporate the required identity/session foundations now; implement the remaining calling transport afterward. A user-management milestone cannot claim end-to-end call revocation, accounting or media cleanup verified before calling integration.

Use the existing modular backend, PostgreSQL authority, Redis transient coordination and native protected identity. Preserve package/toolchain versions and unrelated working-tree changes. iOS, frontend-web, IPv4 relay, FTP, groups, recording, social login and MFA remain outside this initial implementation. Recovery/email endpoints and provider callbacks belong to the Go backend; they do not start the deferred web phase.

#### User-selected decisions

| ID | Accepted choice |
| --- | --- |
| D01 | Username/password plus saved offline recovery codes and optional verified recovery email. |
| D02 | Defer MFA initially; do not describe device metadata or email recovery as MFA. |
| D03 | Allow username changes; no separate display name initially. Stable account IDs, keys, contacts and trust survive renaming. |
| D04 | Reserve previous usernames to their original account while it exists. Only the current username works for login/discovery; no public alias redirect. |
| D05 | Seven-day registered-account deletion cancellation window. Revoke authorization immediately; cancellation requires fresh authentication and newly authorized sessions. |
| D06 | Permanently retire every username used by a permanently deleted account, retaining minimal availability-blocking records. |
| D07 | Unlimited registered direct-IPv6 duration. Security, concurrency, lease, key and abuse limits remain. Preserve guest usage through conversion; a mixed call remains bounded by its guest participant. |
| D08 | Explicit logout/local profile removal before another account logs in. Support shared/resold devices without requiring the previous owner's password. |
| D09 | Registered discovery by exact current username only; no guest directory, recovery email, IP or online/busy disclosure. |
| D10 | Unknown callers submit non-ringing requests. Opening each request shows Accept and Block. Accept authorizes this call only and does not make the caller known. |
| D11 | Adding a contact explicitly grants directional future-ringing permission. Explain this in the Add Contact UI. Device verification remains separate. |
| D12 | Resend for initial transactional email, behind a replaceable backend interface. No purchase, live sending or DNS change authorized. |
| D13 | Require acknowledgement of saving recovery codes before completing registered setup, including existing users after successful login. Acknowledgement is not proof of external storage. |
| D14 | One optional verified recovery address per account, unique across accounts. Unverified addresses confer no ownership/reservation. |
| D15 | Configurable rolling retention for visible registered call history, initially 90 days, clearable earlier by its owner. Guest history remains unavailable; accounting/reports have separate retention. |
| D16 | Short-lived one-time email codes entered into the app for verification and recovery, separate from saved offline recovery codes. |
| D17 | Configurable control-backend validation target, initially 100 concurrent two-party calls / 200 participants, plus documented other traffic. Future test profiles may raise or lower this target. This is not an account cap or measured capacity. |

#### Engineering defaults for review during contract freeze

These are configurable starting choices, not additional user-selected policies or measured limits. Change them explicitly with rationale and tests, never through undocumented implementation drift.

| Item | Initial default |
| --- | --- |
| Password establishment/change | 15-128 Unicode code points, at most 512 UTF-8 bytes; spaces/password managers supported; compromised/common-password screening; no composition rules or routine forced expiry. Use a versioned normalization/hash profile for newly established passwords; never silently change existing verification semantics. |
| New username syntax | Canonical lowercase ASCII letters, digits and underscore, 3-30 characters. Preserve existing historical handles through reviewed compatibility mappings; do not apply new-name restrictions to existing login access without a migration decision. |
| Saved recovery codes | Ten independently random 128-bit codes, readable grouped encoding; protected server verifiers, single use, one active set, no routine expiry before use/regeneration/revocation/deletion. |
| Email challenge | Eight random decimal digits; 10-minute lifetime; five verification attempts per challenge; one active challenge per purpose/owner/address version. |
| Email resend | 60-second cooldown, five issues/hour and ten/day per canonical purpose and relevant account/recipient scope; admission also subject to operation/network limits. Resend invalidates the previous challenge. |
| Sensitive-action authentication | Fresh password or narrowly scoped completed recovery proof, at most five minutes old, bound to the operation; never an arbitrary existing session alone. |
| Username changes | At most once per 30 days, including reclaiming an old name; server time and atomic uniqueness checks. Failed attempts do not consume the interval. |
| Unknown non-ringing request | Ten-minute expiry, one pending request per caller/recipient pair; bounded inbox and operation rates. Accept only if caller authorization and availability are still current. No indefinite call-slot/quota hold. |
| Retention defaults | Visible history 90 days as selected; minimal routine security audit and settled accounting 90 days; report evidence 90 days after closure. Active cases, reservations and current-period restrictions cannot be erased by cleanup. Overrides need explicit policy review. |
| HTTP operation deduplication | 24-hour outcome retention for ordinary account mutations; same actor/key/payload returns the same non-secret outcome. Auth credential issuance uses controlled recovery, not generic token-response replay. |

Retain Session V2's 15-minute access / absolute 30-day auth / no idle expiry, guest seven IPv6 hours per Monday-UTC week, dormant one IPv4 hour, and configurable 90-day guest/recognition cleanup. Preserve Calling V2's 30-second leases / ten-second renewal / no grace.

### 5. Validation, capacity and completion

#### Required test families

| Family | Acceptance evidence |
| --- | --- |
| Authentication/ownership | Wrong credentials, disabled/pending-deletion accounts, foreign resources, modified local roles, stale generations, concurrent replacements; exactly one authorized outcome. |
| Storage/process | Cold start, kill/reboot, locked store, tokens-only/key-only/refresh-only, interrupted writes/clear, restored backup, corrupt/mismatched key; no silent new identity or false durable success. |
| Refresh/finalization | Concurrent 401s, bounded waiter retry, timeout before/after consumption, reuse, logout/recovery vs late response, native failure; no resurrection, stuck waiters or local capture waiting on network. |
| Recovery/email | Wrong/expired/used codes, failed setup acknowledgement, regeneration races, email uniqueness/version changes, provider quota/outage, delayed/out-of-order/forged webhooks; no unauthorized reset or secret logging. |
| Profile/deletion | Canonical-name collisions, old-name login/lookup, cooldown races, deletion cancel vs purge, worker crash and backup restoration; preserved ownership, minimal retirement and no restored authorization. |
| Guests/conversion | Duplicate enrollment, recognition spoof/provider transition, revoked-key recovery, complete loss, signup/target-login failure, week boundary, reminders/gates and cleanup races; no private-data restoration or erased usage. |
| Social/privacy | Exact lookup, contact/approval changes, directional blocks on all invitation paths, repeat unknown requests, expired requests, rename and old-contact IDs; no IP/email/status leakage or automatic microphone. |
| History/reporting | Owner/guest/foreign access, clear/expiry vs shared call records, account deletion and report retention; one user's clearing cannot erase another's authorized record or accounting. |
| Configuration changes | Retention increase/decrease, prospective/retroactive effective rules, stale cleanup workers and UI policy refresh; no resurrection of erased history. Load-profile changes consistently derive participants/renewal traffic and preserve the measured results for the previous profile. |
| Infrastructure/load | PostgreSQL/Redis loss/restart, stale cache, replica/outbox crash, slow clients and reconnect/authentication storms; bounded work, no stale grants or deadline extension. |
| Calling integration | Physical registered/guest/mixed peers; refresh, new phone, password recovery, deletion, block and quota exhaustion during setup/active/recovery; prompt local stop and lease-bounded remote enforcement. |

Start with side-effect-free unit/mocked checks, then contract tests. Repair the missing IPv6VoiceEngine mock rather than installing/upgrading SDKs. Production-constructor and repository authorization/rotation tests are required; legacy-service happy-path tests alone are insufficient. Inspect every integration harness for writes before running it. Use the repository's focused npm/Go commands and the existing toolchain; do not silently reconcile the recorded Go manifest/host difference.

#### Initial performance experiment

Use a versioned load-test configuration profile, initially modeling 100 two-party calls: approximately 20 participant renewals/second, with 500 additional idle authenticated event connections, two login attempts/second, five ordinary authorized user operations/second, and a separate burst reconnect of all modeled clients. Run a 30-minute steady test plus outage/reconnect cases on recorded hardware, database and Redis settings. These added traffic values and durations are engineering test defaults, not user-selected capacity promises. Real media flows never enter the load-test database.

Expose call count, idle connections, operation rates, burst shape and test duration as validated test-run configuration/CLI overrides; derive participant and renewal counts from call count and the accepted lease cadence. Raising or lowering the target requires a new recorded test run, not application-code edits, a schema migration or changes to security deadlines. Record profile version, effective parameters, hardware and results together. A changed target neither imposes a runtime account/call cap nor establishes new measured capacity; resource scaling and any operational concurrency limits are separate reviewed configuration.

Starting objectives: p95 below 500 ms for lightweight authorized operations, p95 below two seconds for password operations, under 1% unexpected errors during steady load, and no growing queues/memory across the steady interval. Measure p50/p95/p99, renewal completion before expiry, CPU/memory, hash concurrency, pool/lock wait, DB/Redis latency, outbox/worker lag and backlog recovery. Deliberate outage denial/lease expiry is expected policy, not an availability success. Refine targets from deployment resources and evidence before production claims.

Bound authentication workers by measured memory/CPU independently of renewal/termination capacity; the current Argon2 profile uses substantial memory per verification. Keep sockets independent of DB connections. Size the total DB connection budget across replicas, not per replica in isolation. Canonical route/method API budgets stay independent; IP/recipient scopes supplement the same operation. Required security coordination fails closed under its documented outage policy. No arbitrary total-account cap or unlimited-concurrency claim.

#### Completion evidence and operational prerequisites

User-core completion requires the selected features, their negative/recovery tests, reviewed migration handoff, documentation consistency and no unresolved critical/high findings in the assessed scope. Keep a requirement-to-test/evidence checklist with implemented, mocked, device-verified and integration-verified states. Open lower-risk findings need a bounded mitigation, owner and follow-up criterion; acceptance is not a zero-vulnerability guarantee.

Before live email: the user supplies a Resend account, verified sending subdomain, sender address, webhook configuration and secrets through approved local/deployment configuration. Review the provider's message-content retention; its infrastructure processes recipient/content data. Keep tests mocked until an explicit sending target is authorized. A provider choice is not subscription/purchase approval.

Before database/concurrency/load validation: the user identifies and authorizes an isolated target and supplies deployment hardware/budget. Do not assume the connected DB is disposable. Document actual limits and failed scenarios; increase resources or reduce the supported launch target explicitly if measurements fail.

Update this plan as milestone contracts/evidence become concrete, without duplicating system ownership. Preserve source-notes.md and the historical September baseline. Completing this document itself changes no application or database behavior.

### Reference basis

- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html): password and authenticator guidance; no claim of a NIST assurance level for this application.
- [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [ASVS](https://asvs.owasp.org/) and [MASVS](https://mas.owasp.org/MASVS/): risk/control and verification references, not certification.
- [Resend Go integration](https://resend.com/docs/send-with-go), [verified domains](https://resend.com/docs/dashboard/domains/introduction), [webhooks](https://resend.com/docs/webhooks/introduction) and [pricing](https://resend.com/pricing?product=transactional): provider research supporting D12. Recheck pricing/limits before purchasing; no plan purchase is assumed.

## Account API V2

### 6. OPEN decisions that block implementation

1. ~~**Noise IK enrollment profile.**~~ **Decided 2026-11-01** (see [decisions](decisions.md)): `Noise_IK_25519_ChaChaPoly_SHA256`, prologue = purpose label + setup-grant id + server challenge nonce, server key pinned from an authenticated bootstrap endpoint with old-key-signed rotation. The Go primitive exists and passes the official noise-c vector plus negative tests. **Still open:** the enrollment message formats (`/auth/enroll/challenge` and `/finish` bodies), key-rotation message format, and a phone-side `noise-java` IK run against the Go server.
2. ~~**Dependencies.**~~ **Decided:** no new dependency; Noise is implemented in-house on the pinned `golang.org/x/crypto` (go.mod/go.sum unchanged) and Resend uses the standard Go HTTP client.
3. **Deployed schema inventory.** A read-only target (or schema dump) is required before any executable upgrade SQL. Blocks migration 015.
4. **Legacy username mapping.** Preflight report of existing handles that violate the new grammar. Blocks M4.
5. **Email delivery encryption key** source (env var and rotation). Blocks M3.
