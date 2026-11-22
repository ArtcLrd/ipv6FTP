# Security and privacy model

## Currently Implemented in Code

Account event tickets are bound to the authenticated principal, device, session and authorization generation. Only a hash is stored, consumption is atomic, and the stream revalidates durable session authorization. Tickets travel as a WebSocket subprotocol rather than a query parameter. Messages are invalidations; the client obtains an authenticated bootstrap snapshot before changing protected state. Database and device verification are pending.

Account switching compares the password-authenticated enrollment challenge principal with the retained device profile before native proof. Profile removal clears the retained record after the scoped native key and peer trust have been removed.

The signed-out marker blocks credential restoration as soon as it is saved. An interrupted deletion of legacy credential slots resumes from the marker on startup. An access token retained in memory for a server revocation retry stays scoped to that logout attempt.

Expo writes the refresh uncertainty marker before sending the refresh token. It validates both replacement credentials before persisting them and releasing waiting requests. If secure storage is unavailable before dispatch, the client blocks protected access and offers storage retry. A lost response after dispatch requires reauthentication.

V2 restore reads the installed Android key and compares its derived X25519 fingerprint with the authenticated bootstrap snapshot. If backup data survives without the device's wrapping key, the app requires password sign-in and a fresh enrollment challenge. Temporary Keystore errors propagate so the app can retry. Profile removal records an intent that survives restart and clears keys and peer trust scoped to that profile. Audit and outbox entries record account operations without storing credentials or recovery codes.

> Password change checks the operation-bound fresh-authentication grant and passes its credential version into the transactional update. A concurrent password or recovery change cannot authorize a write under a stale grant. The app marks local credentials uncertain before sending the password mutation and fences the former identity; it stops capture and makes a bounded best-effort server call-end attempt. Mocked tests cover these paths, while database race and device validation remain pending.

> The v2 setup client blocks normal authenticated UI until a matching bootstrap reports an active account, and checks that the principal-scoped native identity is present. Recovery-code acknowledgement is bound to the current active set by verifying one code under the account lock; this prevents a late acknowledgement of a retired set from acknowledging its replacement. Code values must remain out of logs. Native and database-backed race tests remain pending.

> The Android UDP receiver now checks the authentication tag before a packet can enter the reorder queue or advance its receive sequence. This addresses unauthenticated sequence poisoning in source. Native build and adversarial packet validation are pending, along with the wider V2 replay-window work.

> A confirmed invalid session or uncertain dispatched refresh immediately invalidates the current identity generation. Concurrent responses from the previous generation are rejected, preventing a late profile response from restoring authenticated UI while recovery is required.

> Bearer JWTs must include an expiration claim. Expired bearer credentials must have the access-token purpose before the backend returns a refresh-eligible expiration code. The middleware also rejects expiration combined with invalid signature, issuer, audience or not-before claims. These classifications have mocked HTTP middleware tests.

> The app error boundary emits a fixed diagnostic rather than passing raw exceptions or component error objects to logs or telemetry. Socket callback fencing prevents events from an earlier connection from being delivered through the current connection's listeners.

> The shared HTTP client captures identity generation before asynchronous request interceptors run. A caller-supplied cancellation signal is combined with identity cancellation, and its listener is removed when the request settles. This prevents tested queued and in-flight client requests from silently transferring to a later identity.

> The database-backed refresh path rejects expired or revoked authorization and distinguishes a confirmed invalid token from an error after committed rotation. Reuse revocation errors are propagated rather than ignored. These changes have mocked service coverage but have not been validated against a connected database.

> The current client requires a signed-out state before starting registered login or registration. Successful authentication clears private query, user and prompt projections before publishing the new account. Rejected refresh credentials block authenticated UI immediately, including while secure-store cleanup is pending. These behaviors are covered by mocked tests; guest conversion remains a later flow.

> Native session-end handling gates events on an authenticated active call and fences several asynchronous call operations by identity generation. Android event payloads include a call ID and per-preparation attempt ID; native transport and audio callbacks capture their attempt before touching controller state. JavaScript coordinates overlapping prepare/end operations and its ordering is covered by deferred-promise tests. A native stop that has not completed within five seconds produces a retryable local logout failure; the underlying operation is not assumed cancelled and subsequent preparations remain blocked until teardown settles. Native build and device validation remain required.

> Partial credential-storage implementation: the Expo credential record has active, signed-out and uncertain-refresh states, serialized storage operations and no memory fallback. Legacy credentials are retained until the replacement write succeeds. Login, registration, profile and refresh writes use in-process generation checks, including tombstoning a superseded in-flight write. Startup now presents recovery states and logout clears query and user projections; broader cancellation, cache-isolation and race validation remain required before claiming a complete logout/refresh guarantee.

> Partial implementation: session-validation infrastructure errors propagate to the middleware and return `AUTH_UNAVAILABLE` instead of being represented as invalid sessions. The client limits interceptor refresh to `ACCESS_EXPIRED`, uses partial in-process generation fencing and persists uncertain refresh outcomes. Outage-safe recovery and lifecycle tests remain incomplete.

## Target New Flow (To Be Implemented)

The account enrollment and peer-call handshakes have different purposes. Treat network input and rendezvous metadata as untrusted. Room codes locate sessions and do not prove identity. Endpoint compromise and denial of service remain outside the protection offered by E2EE. Relay service and IP-hidden routing are deferred. Keep plaintext media, private keys, traffic keys, credentials and recovery-code values out of server storage, logs and telemetry. See [decisions](decisions.md) for the selected enrollment profile and [system status](system.md#currently-implemented-in-code) for the current source snapshot.

## Calling V2

### 6. Handshake and canonical context

Use the candidate `Noise_XX_25519_ChaChaPoly_SHA256` through reviewed Android/Go-compatible implementations. Original caller is initiator; peer is responder. Enrollment Noise IK is separate. Peer private keys and derived media keys never go to the server.

After mutual readiness, the initiator sends XX message 1; responder processes and sends message 2; initiator processes and sends message 3. Verify the expected static device keys and agreed context; complete handshake before installing transport state. Follow library state transitions rather than implementing raw cryptography.

#### Deterministic context

Encode a fixed-order deterministic-CBOR structure containing:

1. Application/protocol identifier and version.
2. Logical call ID, proposed 128-bit connection ID and key generation.
3. Initiator principal UUID, device UUID and 32-byte X25519 public key.
4. Responder principal UUID, device UUID and public key.
5. Agreed media profile and direct-IPv6 routing policy.

Use UUIDs as 16-byte values, unsigned integers within defined ranges, and fixed initiator/responder ordering. Bind through the Noise prologue. No usernames, tokens, IPs or wall-clock-dependent values belong in this identity context. Both endpoints must agree on the connection reference before readiness; different context bytes fail authentication. Specify exact CBOR field/type codes and test vectors before coding interoperability.

REST may remain JSON; it is not the canonical cryptographic encoding. Deterministic CBOR uses fixed schemas, definite lengths and a restricted type set; reject noncanonical encodings, unknown fields/tags, unsupported versions, ambiguous numbers and excessive nesting. No arbitrary data graphs or executable payloads.

#### Failure/duplication

Wrong expected key, conflicting generation/context, unexpected handshake step or failed authentication aborts the setup attempt. Duplicate delivered frames must not advance Noise twice; reconcile by step and bounded stored message identity. Conflicting duplicates fail the attempt. Bound frame sizes and total processing. An outsider's invalid post-setup datagram is discarded, not an instruction to terminate a healthy call or trigger expensive handshakes.

No fallback to an unauthenticated/weaker profile. Ordered WSS delivery does not eliminate application deadlines or reconnect state. Any direct-UDP carriage of renewal/recovery handshake frames needs an explicit bounded encapsulation/retry contract; a generic encrypted control channel alone is not that complete specification.

### 7. Verification links, QR, and remembered trust

#### First contact

1. Finish the handshake and locally obtain its full 256-bit fingerprint/hash under the finalized profile.
2. Offer Share verification link, Show/Scan QR, and a full readable fallback. Both link and QR encode the same versioned call/generation/fingerprint binding.
3. Compare through an independently authenticated external channel, or scan directly in person. Our own signaling service distributing matching values is not independent verification.
4. Recipient parses locally and matches against its active handshake. Opening a URL must not join, replace trust, fetch arbitrary destinations, authorize operations or start capture.
5. Each side explicitly confirms its own comparison. Mismatch, decline, stale generation or timeout ends setup; no unverified-audio bypass initially.
6. Exchange protected, handshake/generation-bound confirmations after a destination/transport is available. Remember successful device trust only under the intended binding; retain enough provisional local confirmation state without sending prematurely.

Verification URLs contain no private/media keys, auth/refresh tokens or join credentials. Use app/HTTPS links; a fragment is a candidate payload location but does not eliminate history/share/log leakage. App-link association, exact encoding, local validation and expiry handling require specification. Do not shorten the fingerprint to a few digits without a reviewed short-authentication-string protocol.

#### Returning peers

Store local principal scope, remote principal/device/public-key binding, verification method/time and record version. No arbitrary time expiry initially. Fresh handshakes check this binding automatically; manual comparison is unnecessary for unchanged verified device identities even after IP changes or media-key renewal.

Require fresh verification for a new phone/key, forgotten/lost/reset trust or incompatible security policy. A revoked key is blocked until authorized replacement, not merely accepted by another QR confirmation. Ordinary logout may retain protected account-scoped trust; a different local account cannot inherit it. Reinstall/new phone does not automatically migrate trust. Guest conversion transfers trust only through an ownership-preserving user/session operation. Backend metadata cannot silently overwrite verified keys. Labels say Verified device/Previously verified device/Device key changed, not Safe person.

### 14. Key renewal

Device identity persists separately from temporary traffic keys. Proposed operational defaults: begin fresh-handshake renewal at 45 minutes; stop old-key use at 60 minutes or 2^20 allocated packets in either direction, whichever is first. Start early enough before packet limits to finish renewal; never wait until exhaustion. These are conservative application test defaults, not universal cipher security limits.

Original initiator coordinates; the other peer may request renewal. Negotiate one pending next generation. Use fresh ephemeral handshake material, expected verified identities, canonical context and new connection reference. Routine renewal retains device trust and media timeline, not media keys. A changed identity key requires fresh human verification.

Prepare new receive state before switching sends; old/new keys and replay windows remain separate. At most two seconds of old receive overlap, further bounded by hard key/authorization deadlines. Drop stale audio regardless of overlap. An explicit promotion/loss-recovery contract must prevent one-sided key switches; do not claim that generic ACKs alone solve this.

Old audio may continue during renewal while authorized and within limits. If renewal fails, retry within budget; at hard expiry pause/stop old-key media and recover or end. Never extend key use indefinitely or fall back to old keys after retirement. Rate-limit/coalesce requests; a malicious peer cannot force unlimited parallel handshakes. Direct renewal requires a specified reliable handshake-control encapsulation; WSS forwarding is an alternative control route, not media forwarding.

### 15. Authorization leases and one-phone enforcement

Each participant renews a proposed 30-second call authorization every 10 seconds via Go; no extra grace after expiry. Validate current session/device, active-phone authorization generation, both accepted participant bindings, call/generation state, restrictions and allowance before extending. Revoking A prevents continuation renewal for the affected call, including B's authorization. Do not grant stale cached permission after a durable revocation.

Lease binding includes call/participant/device/session ownership, authorization and connection generations, expiry and operation identity as needed. Exact response schema remains to specify. Use authenticated server responses and conservative monotonic local deadlines; delayed responses, wall-clock rollback, suspension or retry cannot extend authorization. Recheck before resuming capture after wake.

Healthy peer audio may continue during backend outage only until current lease expiry. Retry boundedly; success before expiry continues the call, otherwise stop. Redis failure allows only an explicitly safe authoritative fallback; otherwise renewal fails closed. Access-token refresh alone does not rekey audio.

Successful new-phone login/enrollment atomically replaces active-phone ownership and revokes old sessions. Failed attempts do not disturb the old call. Notify both old call participants; refuse renewal; stop via client finalizer. New phone does not inherit the active call or old trust; start a new call and verify its device key. Account recovery is specified elsewhere. Immediate remote termination cannot be guaranteed offline; a compliant client is bounded by the remaining lease. Compromised endpoints may ignore policy.

## Session V2

### 2. Identities and replaceable providers

| Concept | Purpose | Not sufficient for |
| --- | --- | --- |
| Principal UUID | Registered/guest subject and ownership | Proving possession |
| Backend device UUID | Stable enrolled-device reference | Permanent physical-phone identity |
| Device key | Protected private material plus enrolled public verification key | Account recovery after key loss without other proof |
| Auth session UUID | Device-bound server authorization | Proof that an old token is still valid |
| Access/refresh credentials | Present/renew session authorization | Ignoring revocation or active-phone rules |
| Recognition signal | Best-effort reinstall quota continuity | Restoring prior identity, data or peer trust |
| Allowance bucket | Shared accounting scope for recognized guest enrollments | Account authentication |
| Call/connection generations | Fence stale call/identity operations | Independent permission |

UUIDs reduce simple enumeration; ownership checks and parameterized SQL remain necessary. IDs, usernames, IPs and public keys alone are not authentication secrets.

#### Recognition and identity providers

Keep separate interfaces for recognition, cryptographic identity, backend device ownership and allowance policy. Record provider/type, algorithm or credential profile where relevant, version, scope and status. The rest of session management depends on those contracts, not a hardcoded Android API or cipher.

Android recognition initially uses ANDROID_ID, not IMEI. Backend derives a purpose-scoped, versioned keyed representation for lookup. This minimizes raw identifier handling; it does not validate truth of the client signal or make records anonymous. Modified clients can falsify signals. Ordinary reinstall deterrence is the objective; factory-reset resistance and permanent physical-device bans are not promised. Android user/profile and signing changes can affect recognition.

Provider changes require explicit linkage/migration, controlled key rotation and retirement; they must not silently allocate fresh quota. Changing cryptographic keys requires ownership/re-enrollment checks and fresh peer trust as calling V2 requires. A DB toggle cannot implement an unsupported algorithm. Define transition tests before replacing providers. iOS recognition is not assumed equivalent: identifierForVendor can change after uninstall, and DeviceCheck offers limited anti-abuse state rather than an arbitrary quota identifier. Exact iOS policy remains deferred.

#### Binding rules

One current account profile per recognized device in first delivery, and one active phone per account under calling V2. Do not provide simultaneous account profiles or independent fresh guest allowances through reinstall. Same-account restoration/recovery remains possible. Controlled account replacement/removal must support shared/resold devices without exposing old data; its exact authorization/UX is a prerequisite, not an irreversible lifetime device-to-owner binding.

### 7. Expiry and refresh

| Parameter | Accepted configurable default |
| --- | --- |
| Access lifetime | 15 minutes |
| Auth session | Absolute 30 days from issuance |
| Additional idle expiry | None initially |
| Call continuation | Calling V2: 30-second lease renewed every 10 seconds, no extra grace |

Refresh preserves absolute auth expiry and never resets usage. Policy changes follow section 10; local time changes cannot extend authorization. Registered users reauthenticate after underlying expiry; eligible guests may key-recover to a new session. Early revocation overrides remaining token lifetime.

#### Successful refresh

1. One coordinated refresh per client credential/identity generation. Eligible expired requests wait; do not refresh indiscriminately on every error.
2. Backend verifies refresh/session/device/principal/active ownership and expiry. Refresh cannot be used after explicit logout/replacement/revocation.
3. In one transaction consume old token and issue replacement, preserving session reference and absolute deadline. Persist hashed secrets and enough lineage to detect reuse.
4. Persist the replacement bundle before unblocking requests. Each eligible waiting request retries at most once; prevent loops.
5. Logout/account switch/recovery invalidates outstanding generation; late refresh responses cannot restore previous credentials.

#### Lost response and reuse

Timeout alone does not prove revocation or rollback. Do not blindly replay a potentially consumed refresh token. Mark uncertain credentials as needing controlled recovery, preserving device identity. Guest uses approved key recovery, registered user login. Successful recovery atomically replaces the uncertain session and invalidates remaining refresh credentials without resetting allowance. No stored seamless refresh-response replay service initially. Confirmed token reuse invokes session/descendant revocation under the defined lineage policy; distinguish it from merely observing a timeout. A committed successor must never be reactivated by a stale retry/result. Active calls stop if renewal misses their existing lease deadline.

### 17. Retention and audit

Accepted configurable starting defaults: inactive guest cleanup after 90 days and device-recognition association retention for 90 days after last legitimate service use. Do not let repeated registration-gate openings or token refresh alone extend recognition retention indefinitely. Temporary attempts/challenges/tickets/results expire promptly under bounded policies. Audit records use separately chosen category retention; 90 days does not automatically apply to all logs.

Before deleting records, reconcile active auth/calls/reservations/accounting and preserve applicable period restrictions so cleanup cannot grant fresh quota. Resolve concurrent recovery/cleanup transactionally. Exact inactive-guest timestamp/eligibility, recognition rotation/deletion, shared-device replacement and minimum accounting retention are specification prerequisites. Recognition expiry can intentionally end best-effort continuity; do not promise permanent device tracking.

Guest call history remains unavailable in the app, while minimal backend usage/security records remain. Critical audit contains server time, restricted internal references, operation ID, policy/generation, outcome/bounded reason and authorized administrative changes. Critical records/outbox commit with corresponding mutations. Diagnostic logs are bounded and cannot block all work or grow indefinitely. Restrict audit access.

Never log raw access/refresh credentials, passwords, private keys, recovery/enrollment secrets, full authorization headers, audio payloads or routine raw recognition identifiers. Retained keyed identifiers and metadata still require access/retention controls; do not call them anonymous. Independent evidence review distinguishes reported events from proven state.
