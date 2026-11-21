# User-management implementation plan

Status: planning handoff, consolidated 2026-10-31. The 17 product decisions below were selected by the user. Engineering defaults are identified separately. No implementation, migration execution, provider setup, deployment or security certification is claimed.

This is the execution breakdown for the account/login module and the user-facing portions of Session V2 and Calling V2, not a replacement system architecture. [system.md](system.md) remains canonical; [Session V2](session-management-proposed-v2.md) owns session invariants and [Calling V2](call_implementation_proposed_v2.md) owns media/protocol behavior. This plan resolves their user-flow deferrals only as explicitly stated here. Preserve their remaining security gates and specification prerequisites.

## 1. Outcome and boundaries

Complete registered and guest account journeys in the Expo Android app and Go backend, including interruption, concurrency, abuse and recovery behavior. Incorporate the required identity/session foundations now; implement the remaining calling transport afterward. A user-management milestone cannot claim end-to-end call revocation, accounting or media cleanup verified before calling integration.

Use the existing modular backend, PostgreSQL authority, Redis transient coordination and native protected identity. Preserve package/toolchain versions and unrelated working-tree changes. iOS, frontend-web, IPv4 relay, FTP, groups, recording, social login and MFA remain outside this initial implementation. Recovery/email endpoints and provider callbacks belong to the Go backend; they do not start the deferred web phase.

### User-selected decisions

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

### Engineering defaults for review during contract freeze

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

## 2. Feature behavior and recovery

### A. Entry, registration and protected persistence

Keep explicit registered login, registration and Skip-to-guest actions. Cancellation returns to entry. Never create a guest because login failed, storage was locked or infrastructure was unavailable.

Registered setup progresses through credential verification, provisional enrollment, device possession proof, recovery-code setup and final activation. Provisional/setup grants have narrow purposes and bounded expiry; they cannot call, access contacts or become ordinary sessions. Show optional recovery-email setup without blocking registration on email delivery. Final activation requires recovery-code acknowledgement and successful durable credential storage before the UI claims persistent login.

If an account was committed before a response/storage failure, reauthentication resumes its incomplete setup; do not create a second account or silently treat a duplicate username as a fresh success. Lost activation credentials require controlled reauthentication/proof and replacement of the uncertain session. Do not replay raw credentials from an ordinary idempotency cache.

Use a versioned credential bundle with principal/device/session references and local identity generation. Propagate storage failures; remove production memory fallback. Distinguish missing, partial, corrupt and temporarily inaccessible material. A refresh token without an access token is a recovery/refresh state, not absence of identity. Tokens without the required native key cannot restore enrolled-device access.

Scope durable native identity and peer trust by stable principal/device references, not username. Define a reviewed migration of existing username-scoped identities; prove key continuity before linkage. Do not silently generate a replacement key when decrypting a surviving key fails. Check native key writes for durability and serialize creation so concurrent requests cannot create competing keys.

### B. Enrollment, active-phone ownership and authorization

Keep credential authentication, device possession, Android recognition and peer trust distinct. Freeze the purpose-separated Noise IK enrollment/recovery application profile, authenticated server-key bootstrap/rotation, messages, finish semantics, library compatibility, bounds and negative vectors before implementing the exchange. No raw public-key upload or ad hoc signature construction substitutes for it.

Activate principal/device/session ownership transactionally with generation fencing, constraints and audit/outbox. Successful replacement of a phone revokes superseded account authorization; failed proof leaves it unchanged. Ordinary same-phone restoration does not allocate a fresh device, bucket or quota. Every protected request checks current durable session/device/principal state, generation, permission and resource ownership.

Recognized-device profile replacement must not be authorized by ANDROID_ID alone. A resold phone may clear its local profile and authenticate another account without old-owner credentials. This grants no old data/trust and cannot revoke unrelated old-owner sessions elsewhere. Revoke only authorization established by valid credentials/proofs. Preserve restrictions in matched guest buckets.

### C. Bootstrap, refresh, events and logout

Model initializing, signed out, enrolling, recovery setup, restoring, offline/retry, storage locked, recovery required, active, restricted, quota gated, pending deletion and terminating states explicitly. Unknown account types/schema versions deny protected continuation and offer update/retry; do not default them to registered.

Bootstrap returns a revisioned authorized snapshot: principal/device/session/generation, current username/account type, capabilities, policy version, eligibility/reset information, reminder state, deletion state and event-resume context. Foreground/network resumption reconciles it; cached profile information is display-only and cannot grant operations.

Refresh is single-flight per identity generation, deadline-bound and cancellable. Persist validated replacement credentials before waking waiters. Mark every eligible request as retried once, including queued requests. Never retry foreign-generation work after logout, rename-state reconciliation, recovery or account replacement. A timeout after possible refresh consumption enters controlled recovery, preserving identity material; it is not proof of compromise. Confirmed reuse revokes the session lineage. Check device/principal restrictions as well as session expiry during rotation.

Use one idempotent local identity finalizer. First fence work and stop capture/native activity; then attempt bounded call-end/session revocation while credentials remain available; cancel requests, close connections, clear account-scoped caches and credentials. Record local sign-out intent before cleanup where storage permits. If offline revocation or durable local clearing cannot be confirmed, report it accurately and offer retry; never promise stolen credential copies were revoked. Explicit logout must not trigger automatic guest creation/recovery.

Events are recipient-authorized and versioned. Ignore stale generations/revisions; repair gaps/reconnects with snapshots. Outbox delivery is at least once, consumers deduplicate, and notifications do not replace durable authorization. Bound queues, reconnect attempts and resume cursors.

### D. Password, saved codes and recovery email

Password change verifies fresh credentials, atomically changes the credential and revokes existing sessions; the current device may obtain a fresh session through possession/reauthentication. Stop the old call. Preserve its device key/trust only when ownership continuity is proven. Benchmark and bound Argon2 work and parsed hash parameters; preserve supported existing hashes and upgrade only after successful verification under a reviewed compatibility policy.

Show new saved recovery codes once and require acknowledgement before registered setup completion. Interrupted setup or lost code response requires authenticated regeneration, invalidating the prior set. Regeneration and consumption are atomic. Codes must never be logged or placed in analytics, routine screenshots or clipboard history controlled by the application; copy is explicit and accompanied by secure-storage guidance. Do not claim the app can prevent all OS/user copying.

Recovery initiation returns generic outcomes and is throttled before expensive work. A valid saved code or email proof creates a narrowly scoped recovery grant; it does not log the user in. Successful account recovery changes the credential, revokes previous sessions/device authorization and old recovery grants, requires fresh device enrollment, and replaces the recovery-code set. No old call or peer trust automatically returns. Failed recovery cannot revoke an account or disturb its active phone. Without password, usable saved codes or a verified recovery inbox, explain that recovery is unavailable; do not create an IP/UUID/support bypass.

Email add/change/remove requires fresh appropriate authentication. Verify the new inbox before atomic assignment; enforce uniqueness at that point. An unverified pending address cannot block another account's verified ownership. Keep the previous verified address effective until replacement succeeds. Notify the previous address on removal/replacement where available; never silently substitute it after a failed challenge. Email remains private and is not a login alias or discovery input.

Email recovery works when the current username is forgotten because verified addresses are unique. After successful inbox proof, bind the grant to the exact account and email version; never accept a caller-supplied replacement principal. Use the same challenge security for deletion cancellation through recovery. Pending-deletion accounts expose only authorized cancellation/recovery actions.

Go owns Resend calls; the Expo bundle contains no provider key. Use standard Go HTTP tooling unless an additional dependency is explicitly approved. Keep one provider adapter, send timeouts, bounded retry and short-lived encrypted delivery payloads; ordinary outbox/log records must not retain plaintext recovery codes. Do not deliver expired authorizations after queue delays. Verify webhook authenticity using the documented provider scheme, bound/replay-check/deduplicate events and handle bounces/complaints without treating delivery as identity proof. Disable open/click tracking on security messages. Expose quota/delivery failures honestly while leaving registration and saved-code recovery available.

### E. Username, deletion and local profile removal

Allow fresh-authenticated, rate-limited username changes. Atomically reserve the new canonical name, retire the old current mapping to an owner-private reservation, update account revision and publish invalidation. UUID ownership never changes. Existing sessions resolve current labels from snapshots; stale token usernames are never ownership inputs. Reclaiming an owned former name uses the same checks. Old names do not authenticate, redirect or reveal the new name.

Apply the stated new-username grammar/length and case policy consistently across Go, SQL and UI. Preserve existing valid account access; migration preflight reports incompatible/colliding historical names for review rather than silently reassigning them. Signup availability includes current, reserved and permanently retired names, returning unavailable without disclosing reservation history. Repository failures are service failures, not availability results.

Deletion requires fresh authentication, enters pending deletion with a server deadline seven days later, revokes sessions and fences calls/invitations immediately. Normal use is blocked. Cancellation requires fresh authentication or completed recovery and issues new authorization; it never revives old tokens. Cancellation and the deletion worker lock/check the same state/version so only one outcome wins.

After the deadline, an idempotent worker removes personal account data and secrets under the retention policy. An irreversible deletion has no recovery route. Retire all current/previous names using minimal non-public availability-blocking records without retaining the account/profile linkage unnecessarily. Retained keyed identifiers still require access controls; do not label them anonymous. Clean the user's contact/history projections, use an unavailable/deleted marker for another user's historical references where retained, and never rebind them to a later account. Backups follow documented expiry and restoration procedures that reapply deletion/revocation; no claim of instant backup erasure.

Local profile removal stops local activity and clears local account data/keys/trust needed for shared-device replacement. It does not delete the backend account. Require this transition before another account's login. A failed subsequent login leaves signed-out entry. Backend revocation remains bounded best effort offline; recognition restrictions remain separate.

### F. Guests, policy and conversion

Implement explicit authenticated guest enrollment and Android recognition under Session V2, with purpose-scoped keyed recognition values and independent allowance buckets. Minimize recognition responses. Matching recognition never restores old UUIDs, data, keys or trust. Key-only recovery requires current eligible guest ownership proof; explicit logout, revocation, replacement, conversion, blocking or deletion prevents that recovery. Guest key/token loss creates a new principal only through enrollment while matched restrictions survive.

New-account conversion proves guest ownership, creates registered credentials and completes mandatory recovery-code setup before committing the transition. Linking to an existing account first ends guest activity and completes guest logout/profile removal, then authenticates the target account using a purpose-bound, expiring handoff if guest linkage is required. Do not retain two active local profiles. Settle guest reservations/usage, preserve the guest bucket and grant unlimited registered direct-IPv6 entitlement only after success. Never merge contacts/private records merely because a submitted guest ID or recognition value matches.

Backend policy supplies capability routing, weekly allowance/reset and reminder eligibility. Guests cannot access Contacts or visible history. Preserve per-service denial, the all-enabled-service gate, daily UTC/post-service reminders, coalescing and idempotent shown acknowledgements. Gate/refusal paths keep account actions and immediate hangup available. Reinstall, policy changes and conversion cannot erase usage. Actual call reservation/charging/renewal integration remains a calling milestone.

### G. Discovery, contacts, caller controls and history

Rebuild the disconnected discovery/contact contracts against the current identity schema; do not simply reconnect historical handlers or expose global IP/public-key phonebook data. Exact current-username lookup returns minimal authorized account information only. Blocked/disabled/deleted/foreign resources get appropriately generic outcomes. Signup username availability remains a separate public, bounded surface.

Add Contact explicitly explains future-ringing permission. In one transaction create/update the directional contact relation and its separate caller-permission record, with source/version and audit/outbox. Rename does not alter these UUID bindings. Removing a contact revokes its ringing permission; future allowed attempts become non-ringing requests. Block overrides both contacts and invitation entry paths, ends relevant active/pending work, and denies future operations from that principal until explicitly unblocked. Unblocking is an explicit authenticated action and re-evaluates the remaining contact permission; it cannot revive a prior call or invitation.

Unknown requests show Accept and Block together when opened. Acceptance grants this call only; a later attempt remains unknown until added to Contacts. Known callers still need recipient acceptance and all native security gates. Protected key verification is separate from permission to communicate. Do not reveal online/busy status to discovery/blocked callers. Reports record bounded reasons and minimal evidence; submitting one does not automatically prove abuse or permanently suspend another account. Administrative adjudication/dashboard work stays separate, but authorization for report access and call-intervention hooks must be enforced.

Registered history exposes only the requesting participant's projection, with policy-configured expiry (initially 90 days) and clear-one/clear-all operations. Clearing one projection cannot delete another's record or the minimal accounting/report ledger. Guests have no history API access. Do not store audio, media keys or exposed IPs in visible history. Populate real history and verify participant revocation/usage stops during calling integration.

Store visible-history retention as a validated, versioned PostgreSQL policy value, not a constant in the UI, query or cleanup worker. Authorized policy changes record actor, old/new values, version and effective time. Default changes apply prospectively to new history entries; existing entries retain their assigned expiry. An explicitly reviewed retroactive change may recompute expiry for surviving entries, with a preview of affected rows and coordinated reads/cleanup. Workers recheck the current policy/row version before deletion. Increasing retention cannot restore expired or user-cleared history. UI labels and expiry information come from backend policy. Changing this value alone needs no app release or schema migration once the policy mechanism exists; accounting/report retention is independently configured.

Pending invitation/verification links remain distinct. Signed-out invitation entry retains a bounded local intent through authentication, then refetches current authorization/expiry and requests consent. Verification links compare locally under Calling V2; opening a link never joins, installs trust or starts capture. User management must survive process loss without claiming to resume lost media keys/counters.

## 3. Contracts, persistence and rollout

### Contract freeze deliverables

Use versioned account contracts under `/api/v2/` for the new multistage journeys, retaining v1 only for the compatible interim fixes. Specify Go request/response types and matching strict Zod schemas together. Phase 0 produces exact HTTP methods, bounded fields, state transitions, ownership/generation/revision fields and positive/negative contract fixtures before affected handlers are built.

| Contract family | Required operations |
| --- | --- |
| Auth/enrollment | Registered/guest begin, challenge/finish/activation, setup resume, recovery-code acknowledgement, bootstrap, refresh, logout. |
| Account security | Password change; saved-code create/ack/regenerate; email challenge/verify/remove; recovery begin/prove/complete. |
| Account/profile | Current profile, username availability/change, deletion request/status/cancel; device/session list and scoped revoke/all-session logout. |
| Social | Exact lookup; contact list/add/remove; block list/block/unblock; non-ringing request list/accept/block; bounded report submission. |
| Policy/history/events | Eligibility/reminder snapshot and acknowledgement; participant history/clear; authorized snapshot/resume; Resend webhook. |

Use structured errors for validation, expired authentication, forbidden/restricted state, conflict, quota/reset, rate/retry-after, pending operation, infrastructure unavailable and unsupported client/schema. Refresh only on the explicit eligible authentication outcome. Reject wrong methods, excessive/malformed/trailing payloads and foreign IDs before mutation. Bearer credentials stay in headers, not generic query URLs. Socket tickets keep their separate reviewed contract.

Retryable account mutations carry actor-scoped operation IDs and payload fingerprints. Duplicate success returns a bounded original non-secret outcome; changed payload conflicts. PostgreSQL commits state/audit/outbox together. Security outcomes consult primary/current authority; stale caches/replicas cannot extend grants. Stable lock ordering and bounded serialization/deadlock retry cover cross-account/device/bucket changes.

### Required logical persistence

Prepare ordered migrations for account lifecycle/current username revision, owned username reservations/retirement, device ownership generations, session/refresh lineage, enrollment/setup/recovery operations, recovery-code sets/consumption, pending/verified unique recovery emails, versioned policy, recognition/buckets, directional contacts/permissions/blocks, reminder presentation, history visibility, minimal audit/report evidence and outbox/worker claims. Reuse compatible existing objects; do not duplicate historical schemas.

Keep secrets hashed/protected and delivery payloads separately encrypted with bounded expiry. Add unique/FK/check constraints and indexes for authorization, canonical names, verified email, active ownership and due-worker queries. Profile/key/recognition and refresh-lineage retention cannot resurrect access or reset current-period allowance. Minimal routine audit/accounting defaults are separate from visible history; reports require restricted access and explicit closure state.

### Compatibility and migration safety

Preserve existing data by default. Migration 014 is a separate destructive reset; do not run it or historical bootstrap scripts on any database that holds data worth keeping. Status: on 2026-11-01 the user applied 014 and 016 (with `--allow-destructive-reset`) to their local development database `ipv6ftp` after taking a verified `pg_dump`; all existing development rows were intentionally discarded. This is not evidence for any other environment. Inventory the intended deployment schema and client versions through an authorized read-only target before designing executable upgrade SQL. Source alone does not establish which migrations were applied.

Provide migration purpose, objects/data, prerequisites, locking/backfill risks, deployment order, verification SQL and rollback/recovery notes. Use additive schema/backfills before enabling v2. At cutover, disable legacy credential issuance/recovery paths that bypass enrollment, acknowledgement or current ownership and return a typed upgrade-required outcome. Revoke/replace incompatible old authorization deliberately; old binaries must not keep a security bypass. Rollback may disable new operations but must not re-enable revoked credentials, retired names or weaker admission.

No live DB mutation, migration execution, test seeding, provider setup or DNS action is authorized by this plan. Existing users keep supported credentials during compatible rollout and complete recovery setup after login; enrollment/acknowledgement gates apply before full new authorization. Do not release an interim fix as a completed V2 system.

## 4. Ordered implementation milestones

| Milestone | Implementation and exit evidence |
| --- | --- |
| M0: contracts and baseline | Capture current source/test baseline; inspect default-build repositories and direct callers. Freeze schema/state/error/crypto contracts and fixtures, compatible identity migration, provider callback verification and deployment preflight. Complete focused threat review. Identify exact dependency changes for separate explicit approval before installation. |
| M1: existing-flow correctness | Fix storage propagation, partial states, refresh deadlines/queues/generation fences, immediate logout/local-stop ordering, account-cache isolation, safe retries, visible registration errors and repository-error mapping. Repair native mocks and replace obsolete auth expectations. Unit tests prove outage, storage and logout races. |
| M2: durable identity/session core | Prepare reviewed additive migrations; implement enrollment/activation, stable native key scope, one-phone ownership, current generation/permission validation, refresh lineage, idempotency/audit/outbox and bootstrap. Mocked tests plus separately authorized isolated DB race tests prove atomic ownership. No guest or social bypass through v1. |
| M3: registered account security | Mandatory saved-code setup, password change, recovery begin/prove/complete, optional unique verified email, Resend adapter and code delivery/callback lifecycle. Tests cover lost code results, replay, stale email versions, concurrent claims, compromised/expired authorization and provider outage. |
| M4: profile and account lifecycle | Username changes/reservations/retirement, session controls, seven-day deletion/cancellation, bounded deletion workers and local profile removal. Test rename/availability and deletion/cancellation races, failed cleanup/restart, private data isolation and resold-device behavior. |
| M5: guest identity and routing | Explicit enrollment, recognition/bucket linkage, approved key recovery, conversion, versioned eligibility, gates/reminders and retention. Test spoofed recognition, partial material, stale conversion handoffs, period/config boundaries and no quota reset. Use a fake call consumer until integration. |
| M6: related user journeys | Exact discovery, current-schema contacts and permission grants, remove/block/unblock/report, unknown inbox and signed-out invitation intent. Implement participant history API/policy and UI with mocked call data. Test foreign IDs, stale names/events, duplicate actions, blocks through every entry path and no endpoint disclosure. |
| M7: reliability and user-core release gate | Reconnect/snapshot/outbox/worker repair, independent route/method limits and measured resource budgets. Run storage/process/backup/device tests, authorization/fuzz/race tests and ASVS/MASVS control review. Record residual risks and unresolved call-dependent verification. |
| M8: Session/Calling V2 integration | Bind actual call membership/leases to auth sessions/devices/generations; verify both-party revocation, conversion/logout stop, quota reservation/settlement, reminders/history and native finalizer. Then complete Calling V2's transport/audio phases, two-device/network/outage tests and independent protocol review. |

Do not skip M0's crypto interoperability gate, execute DB-writing tests without an isolated authorized target, or claim M8 passed from mocked M5/M6 results. Each milestone updates maintained architecture/UI/context documents and reviews the scoped diff. Commit/push only when requested.

## 5. Validation, capacity and completion

### Required test families

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

### Initial performance experiment

Use a versioned load-test configuration profile, initially modeling 100 two-party calls: approximately 20 participant renewals/second, with 500 additional idle authenticated event connections, two login attempts/second, five ordinary authorized user operations/second, and a separate burst reconnect of all modeled clients. Run a 30-minute steady test plus outage/reconnect cases on recorded hardware, database and Redis settings. These added traffic values and durations are engineering test defaults, not user-selected capacity promises. Real media flows never enter the load-test database.

Expose call count, idle connections, operation rates, burst shape and test duration as validated test-run configuration/CLI overrides; derive participant and renewal counts from call count and the accepted lease cadence. Raising or lowering the target requires a new recorded test run, not application-code edits, a schema migration or changes to security deadlines. Record profile version, effective parameters, hardware and results together. A changed target neither imposes a runtime account/call cap nor establishes new measured capacity; resource scaling and any operational concurrency limits are separate reviewed configuration.

Starting objectives: p95 below 500 ms for lightweight authorized operations, p95 below two seconds for password operations, under 1% unexpected errors during steady load, and no growing queues/memory across the steady interval. Measure p50/p95/p99, renewal completion before expiry, CPU/memory, hash concurrency, pool/lock wait, DB/Redis latency, outbox/worker lag and backlog recovery. Deliberate outage denial/lease expiry is expected policy, not an availability success. Refine targets from deployment resources and evidence before production claims.

Bound authentication workers by measured memory/CPU independently of renewal/termination capacity; the current Argon2 profile uses substantial memory per verification. Keep sockets independent of DB connections. Size the total DB connection budget across replicas, not per replica in isolation. Canonical route/method API budgets stay independent; IP/recipient scopes supplement the same operation. Required security coordination fails closed under its documented outage policy. No arbitrary total-account cap or unlimited-concurrency claim.

### Completion evidence and operational prerequisites

User-core completion requires the selected features, their negative/recovery tests, reviewed migration handoff, documentation consistency and no unresolved critical/high findings in the assessed scope. Keep a requirement-to-test/evidence checklist with implemented, mocked, device-verified and integration-verified states. Open lower-risk findings need a bounded mitigation, owner and follow-up criterion; acceptance is not a zero-vulnerability guarantee.

Before live email: the user supplies a Resend account, verified sending subdomain, sender address, webhook configuration and secrets through approved local/deployment configuration. Review the provider's message-content retention; its infrastructure processes recipient/content data. Keep tests mocked until an explicit sending target is authorized. A provider choice is not subscription/purchase approval.

Before database/concurrency/load validation: the user identifies and authorizes an isolated target and supplies deployment hardware/budget. Do not assume the connected DB is disposable. Document actual limits and failed scenarios; increase resources or reduce the supported launch target explicitly if measurements fail.

Update this plan as milestone contracts/evidence become concrete, without duplicating system ownership. Preserve source-notes.md and the historical September baseline. Completing this document itself changes no application or database behavior.

## Reference basis

- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html): password and authenticator guidance; no claim of a NIST assurance level for this application.
- [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [ASVS](https://asvs.owasp.org/) and [MASVS](https://mas.owasp.org/MASVS/): risk/control and verification references, not certification.
- [Resend Go integration](https://resend.com/docs/send-with-go), [verified domains](https://resend.com/docs/dashboard/domains/introduction), [webhooks](https://resend.com/docs/webhooks/introduction) and [pricing](https://resend.com/pricing?product=transactional): provider research supporting D12. Recheck pricing/limits before purchasing; no plan purchase is assumed.
