# Security and privacy model

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

> Planned account-security refinement (2026-10-31): [user-management plan](user-management-implementation-plan.md) requires purpose-bound device enrollment, durable generations, single-use saved recovery codes, optional unique verified recovery email with in-app one-time codes, fresh authentication for sensitive changes, seven-day deletion cancellation without credential revival, and minimal permanent username retirement. MFA is deferred, so do not claim MFA or a higher assurance level from device metadata. Resend processes security-email recipient/content data; provider keys stay backend-only, delivery is not verification, and callbacks require authentication/replay handling. Contacts grant directional ringing permission but never cryptographic trust. No IP/email/status disclosure through discovery. These controls remain unimplemented/unverified until milestone evidence exists.

> Accepted session boundary (2026-10-20): [session V2](session-management-proposed-v2.md) separates device-key authentication from best-effort Android recognition used only for quota restrictions. Reinstall matching never restores old identity/data/trust. Every protected operation checks durable authorization/ownership, guest explicit logout ends local key recovery, and credentials never enter logs. Backend revocation, independent per-API limits, minimal audit and bounded recovery supplement native key/packet checks. Accepted policy is not a verified security guarantee.

> Design update (2026-10-17): [V2](call_implementation_proposed_v2.md) specifies current calling trust/packet boundaries, full-fingerprint QR/link verification and remembered device keys, replay-safe controls, validated migration, key limits, 30-second authorization, and safety intervention. Enrollment uses a separate accepted Noise IK candidate in the user/session boundary. IPv6 address or account login alone never establishes intended-peer trust. Restrict even authenticated decoder/control input; captured ciphertext/metadata, flooding and endpoint compromise remain limitations. Client termination cannot undo an exploit or forcibly stop uncooperative direct endpoints. V2 takes precedence over older open-choice statements below; no implementation guarantee is implied.

This describes target requirements, not an audit or verification of the repository. The main boundary is **authentication, replay protection, and protocol authorization before decoding or performing operations**.

Historical code boundaries appear in [current-implementation.md](current-implementation.md). Newer native code still requires review and remediation, especially readiness, verification-send ordering, the full replay-window design, bounded input, renewal and cleanup. V2 specifies desired behavior, not evidence those gaps have been repaired.

## 1. Assets and trust boundaries

Protected assets include voice contents, identity secrets, ephemeral secrets, traffic keys, user consent, and call integrity. Addresses and traffic metadata have different exposure properties.

| Boundary | Required treatment |
| --- | --- |
| Internet to listener | Hostile datagrams receive bounded parsing and authentication |
| Rendezvous to peer identity | Server-authenticated signaling alone does not prove the intended person's device key |
| Ciphertext to plaintext | Authentication failure never releases tentative plaintext to consumers |
| Authenticated message to operation | Enforce schemas, negotiated capabilities, state, and consent |
| Voice frame to decoder | Apply codec bounds; authenticated peers may be malicious |
| Application to host | Expose only intended ports/services |

## 2. Identity and handshake

V2 selects X25519 device identity with fresh ephemeral material and candidate Noise XX for peer calls. Device-server enrollment's accepted candidate is separate Noise IK. Exact application encoding, library compatibility and review remain prerequisites, not implementation guarantees.

V2 requires independent full-fingerprint link/QR comparison at first contact and changed keys, then remembers verified device-key bindings locally. There is no initial unverified-audio bypass. A username, directory entry, IP or newly enrolled replacement key cannot silently inherit trust. Revoked keys remain blocked. Security-policy and trust-format changes can require renewed verification.

A compromised rendezvous can try key substitution. Protection requires a trust anchor or verification channel it cannot replace. If clients accept any key supplied by rendezvous, protection from a malicious rendezvous cannot be claimed. Changed-key, revocation, recovery, and guest policies must be specified.

Bind agreed security context through the selected protocol's mechanisms. Merely exchanging ephemeral public keys does not authenticate a person. See the [Noise Protocol Framework](https://noiseprotocol.org/noise.html) for protocol and application responsibilities.

## 3. Cryptographic invariants

Source requirements are separate directional keys, authenticated transcript/context, encode-before-encrypt, authenticate-before-decode, packet-number replay protection, and endpoint-only media keys on every path.

Proposed completion requirements:

- Follow the selected library/profile's key schedule, nonce construction, and usage limits.
- Authenticate security-relevant application headers as AAD.
- Never reuse a key/nonce pair for distinct encrypted packets across streams, controls, retries, restart, or migration.
- Unauthenticated input cannot change replay state, call state, keys, or trusted destination paths.
- Use platform cryptographically secure randomness and the selected library's peer-key validation.
- Discard transient secrets on termination and protect durable identity storage.

Verify nonce and associated-data handling against the selected AEAD contract; [RFC 5116](https://www.rfc-editor.org/rfc/rfc5116) defines the generic requirements.

## 4. Threat model

| Threat | Target defense | Limitation |
| --- | --- | --- |
| Copy packet fields and forge voice | AEAD before dispatch | Depends on keys, nonce safety, and implementation correctness |
| Modify ciphertext or protected header | Tag verification | Attacker can still cause loss |
| Replay a valid packet | Replay window | State must remain correct under concurrency and recovery |
| Substitute handshake keys | Authenticated protocol plus intended-peer trust policy | Malicious-rendezvous resistance needs an independent trust basis |
| Guess a room code | Separate admission, consent, and peer verification | Discovery abuse still needs limits |
| Reflect packets into opposite direction | Distinct directional keys | Role/key mapping must be correct |
| Send authenticated malformed media | Schemas, frame limits, maintained codec | Decoder vulnerabilities remain possible |
| Send a forbidden operation | Explicit types and state authorization | No generic execution path may exist |
| Redirect using a copied connection ID | Authenticated path/return-reachability validation | Migration protocol remains open |
| Flood endpoint/service | Firewall, quotas, bounded processing | Link saturation and denial of service remain possible |
| Compromise relay | Endpoint-held keys and protected frames | Relay sees metadata and may disrupt/correlate traffic |
| Compromise endpoint or malicious participant | Outside E2EE boundary | Plaintext may be captured or recorded locally |

Forward secrecy depends on the chosen ephemeral authenticated construction and secret deletion. Naming X25519 alone does not establish that guarantee.

## 5. Endpoint protection

Use IPv6 firewall rules, minimal listeners, strict parsing, and resource/rate limits before and after authentication. Unknown sessions must not create unlimited state or large responses. Bound logs so packet floods cannot exhaust disk or CPU.

Keep maintained codecs behind validation and restrict frame size and negotiated parameters. Authentication does not make a decoder invulnerable. Relay authorization and quotas must prevent open forwarding and amplification.

## 6. Privacy by mode

| Mode | Peer visibility | Infrastructure visibility | Not guaranteed |
| --- | --- | --- | --- |
| Direct IPv6 | Other caller's current media endpoint | Signaling metadata and network addresses/timing/sizes | IP hiding or resistance to traffic analysis |
| Relay-only / IP-hidden from peer | Relay address; direct address must be absent from signaling/probes | Single relay sees connecting endpoints and traffic metadata | Anonymity from relay or rendezvous |
| Multi-hop, future | Depends on chosen routing protocol | Depends on relay roles and collusion | No assurance until specified and verified |

Select privacy mode before direct candidate exchange or probing. Hiding addresses in the UI after a direct attempt does not retract disclosure. Relay failure must not trigger direct fallback in this mode.

A blind relay is blind to media plaintext, not metadata. Sizes, timing, duration, and participation may remain visible. Padding, traffic shaping, anonymous credentials, and defenses against global observers are not specified.

## 7. Logs and lifecycle

Proposed logs contain aggregate outcomes, selected path category, bounded errors, and coarse quality metrics. Exclude private keys, shared secrets, media keys, raw/decrypted audio, access tokens, and usable join codes. Minimize stable identifiers and endpoint addresses; define retention and operator access.

Key loss, rotation, identity changes, recovery, and deletion require explicit policies. Memory-erasure guarantees depend on the platform/runtime and must not be overstated. See [decisions.md](decisions.md) for acceptance checks.
