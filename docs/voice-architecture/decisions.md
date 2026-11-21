# Decisions and implementation checklist

## User-management decisions consolidated 2026-10-31

The [implementation plan decision register](user-management-implementation-plan.md#user-selected-decisions) records D01-D17 selected in discussion, including optional verified recovery email/Resend, deferred MFA, saved-code acknowledgement, mutable usernames/reservation/retirement, deletion cancellation, guest conversion entitlement, logout-first profile replacement, exact discovery, contact-granted ringing, non-ringing unknown requests, history retention and the initial capacity test target. Its engineering defaults are explicitly separate from user choices. It resolves the corresponding earlier user-flow deferrals without declaring implementation or protocol verification complete. Follow its milestone exit evidence; keep the unchecked calling acceptance criteria below until actually verified.

## Enrollment handshake decisions, 2026-11-01

Selected by the user while settling the M2 blockers in [contracts draft section 6](user-management-contracts-v2.md):

- **Profile:** `Noise_IK_25519_ChaChaPoly_SHA256`, matching the hash/cipher of the peer-call profile in `NoiseSession.kt` (`Noise_XX_25519_ChaChaPoly_SHA256`). BLAKE2s was considered and rejected for consistency.
- **Go side:** implemented in-house in `backend/internal/noiseik` on the already pinned `golang.org/x/crypto` and the standard library; no new dependency. It reproduces the official noise-c vector byte for byte (`backend/testdata/noise`). No cross-run against noise-java on a phone has happened yet.
- **Replay/purpose separation:** IK has no replay protection, so each handshake binds a purpose label and a fresh server challenge into the prologue (`noiseik.Prologue`).
- **Server key bootstrap:** the phone fetches the server static key from an authenticated bootstrap/config endpoint over TLS and pins it on first fetch; the authenticated enrollment finish establishes a separate P-256 signer pin. The client uses that pin to verify an increasing rotation epoch and each successor X25519 key. Native and deployment verification remain pending.
- **v1 transition:** v1 login/register keep working until cutover; credential issuance is disabled only then.

## Accepted session direction, 2026-10-20

[Session management proposed V2](session-management-proposed-v2.md) supersedes the initial session proposal/research and owns the accepted decision register, flows, defaults, implementation phases and acceptance matrix. It is paired with [calling V2](call_implementation_proposed_v2.md); neither verifies deployment. Older open-choice rows below are historical where inconsistent.

| Area | Accepted session direction |
| --- | --- |
| Identity | Authenticated guests/accounts, UUID records, replaceable versioned recognition and crypto providers; ANDROID_ID quota deterrence, not IMEI or ownership proof |
| Ownership | One profile per recognized device, one active phone per account; controlled replacement, no automatic call/trust inheritance |
| Persistence/recovery | Protected bundle and device key, explicit partial-storage matrix, guest proof recovery without guest recovery codes; uncertain refresh leads to controlled reauthentication |
| Lifetimes | 15-minute access, absolute 30-day auth, no separate idle expiry; calling 30/10-second leases unchanged |
| Guest policy | Seven IPv6 hours/week, dormant one IPv4 hour/week, Monday 00:00 UTC, per-service denial and all-enabled-service gate; Contacts/history unavailable, FTP deferred |
| Prompts | First UTC foreground opening and each completed service; coalesce triggers, no interruption, mandatory gate only at full exhaustion |
| Configuration | PostgreSQL versions; next-period default and explicit immediate option; preserve usage and issued-deadline bounds |
| Authority | Typed authorized intents, PostgreSQL transactions/constraints/locks, outbox/events/snapshot repair; Redis transient coordination only |
| Rates/capacity | Independent canonical-route/method API counters; bounded shared infrastructure budgets, no arbitrary total-account cap or unlimited-capacity promise |
| Cleanup | Immediate local stop/logout; guest key recovery disabled on explicit logout, quota restrictions retained; 90-day configurable cleanup defaults with reconciliation |
| Validation | Multi-instance/race/storage/loss/expiry/policy/limits/physical-device/load/security acceptance before release claims |

Exact schemas/crypto compatibility, shared-device replacement rules, conversion entitlement mapping, safe period/config transitions, retention eligibility/audit durations, measured resource values and iOS recognition are explicit prerequisites in session V2 section 21. Acceptance does not silently resolve them or authorize migrations.

## Accepted calling direction, 2026-10-17

[Call implementation proposed V2](call_implementation_proposed_v2.md) consolidates the reviewed calling choices and supersedes the initial proposal and earlier open-choice rows where inconsistent. See its numbered flows, defaults, phases, and specification-completion section. Documentation acceptance does not complete implementation checkboxes.

| Area | Accepted direction |
| --- | --- |
| Entry | Approved direct registered calls, unknown non-ringing requests, registered/guest code/link admission; background ringing deferred |
| Trust | Noise XX peer context, full-fingerprint link/QR comparison, remembered device keys, fresh verification after identity change |
| Encoding and packets | Deterministic CBOR structured data, 38-byte authenticated header, 1,200-byte cap, directional counters/replay, separate media timeline |
| Audio | Native Android I/O and proposed libopus, bounded jitter/PLC/conditional FEC, direct feedback/pacing/drift, experimental congestion policy |
| Connectivity | Native callbacks, authenticated candidate proof, preserved state for migration, fresh-handshake recovery and renewal |
| Lifecycle | Per-episode recovery, 30-second leases/10-second renewal, no automatic phone transfer, unified irreversible finalization |
| Accounting | Versioned per-call/period tiers, both participants, active intervals/reservations, bounded crash settlement; session V2 now selects weekly guest minutes/boundaries |
| Backend | PostgreSQL authority, Redis temporary coordination, atomic tickets, outbox and shared readiness/reconciliation |
| Safety | Local end/block/report, authenticated per-call intervention, bounded metadata, no payload/key collection or guaranteed permanent physical-device bans |

Numerical settings in V2 are provisional test defaults, not measured production limits. Exact encodings, loss/race transition tables, library compatibility, bounded resources, and independent review remain engineering prerequisites rather than reasons to reopen accepted architecture. Enrollment/recovery/lifetime/admin-retention work remains outside the full calling specification except for integration contracts.

## Earlier lifecycle proposal, 2026-10-16 (superseded where V2 differs)

Read [session management](session-management.md) and [call/peer connection](call-peer-connection.md) together. They supersede the September session gap report as the proposed plan, not as implementation verification. Earlier open-choice rows below remain historical context; O01 is narrowed to native direct IPv6 for first delivery, and Noise XX is the candidate for O03. No release-readiness checkbox is completed by documentation.

| Item | Proposed direction / remaining decision |
| --- | --- |
| First delivery | Registered/guest, two-party code admission, Android native direct IPv6 voice; relay/privacy modes deferred |
| Device enrollment | Require private-key possession; exact reviewed proof protocol/key compatibility unresolved |
| Peer trust | First-contact independent code comparison, remembered verified device keys, changed-key warning/reverification; exact derivation and recovery policy unresolved |
| Auth expiry | Proposed 15-minute access and absolute 30-day session; idle expiry/lost-refresh recovery unresolved |
| Call ownership | Participant devices and authorizing sessions; atomic consent, single-use tickets and generation-bound readiness |
| Path trust | Observed UDP endpoint plus fresh protected bidirectional challenges; address alone grants no trust |
| Liveness/revocation | Renewable leases and coordinated cleanup; cadence, grace, notification transport and outage thresholds unresolved |
| Recovery | Proposed one coordinated fresh-generation attempt; deadline and exact synchronization unresolved |
| Protocol | Canonical context, encoding, packet/nonce/replay limits, control-loss behavior, congestion and test vectors require specification |
| Data/product policy | Guest limits/lifetime, device/account recovery, retention and deletion unresolved |

This separates chosen direction from remaining work. Checkboxes remain unchecked because documentation does not verify implementation.

The [current implementation baseline](current-implementation.md) traces registered-user and guest paths already present in source. The next work section is [session management](session-management.md), which builds on existing auth/call records and identifies integration gaps. Its findings are not fixes already delivered.

## 1. Decisions inherited from the source


| ID  | Decision                                   | Consequence                                                   |
| --- | ------------------------------------------ | ------------------------------------------------------------- |
| D01 | Direct IPv6 preferred                      | Successful direct calls exclude servers from media forwarding |
| D02 | Rendezvous carries signaling only          | Coordination does not require media access                    |
| D03 | Room codes are locators                    | Separate admission, consent, and identity verification        |
| D04 | Established authenticated construction     | No homemade authentication from raw primitives                |
| D05 | Ephemeral X25519, HKDF, transcript binding | Complete profile and trust policy still needed                |
| D06 | Directional traffic keys                   | Separate cryptographic domains for A-to-B and B-to-A          |
| D07 | Opus then AEAD                             | Encoded voice stays inside endpoint encryption boundary       |
| D08 | Validate before processing                 | Plausible packet formatting never establishes trust           |
| D09 | Explicit media/control types               | No generic remote execution                                   |
| D10 | Blind relay fallback                       | Relayed packets retain E2EE                                   |
| D11 | IP-hidden mode skips direct setup          | Policy governs discovery and probing from the start           |
| D12 | Protect the IPv6 host                      | Firewall, limited services, rate limits, strict parsing       |




## 2. Proposed completions


| Proposal                                                      | Purpose                                               | Details                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| State machine and consent gates                               | Prevent actions at the wrong lifecycle stage          | [protocol.md](protocol.md)                                 |
| Header authentication, nonce domains, atomic replay admission | Complete the protected-datagram boundary              | [protocol.md](protocol.md)                                 |
| Bounded buffering and congestion handling                     | Keep voice usable under timing variation/loss         | [flows.md](flows.md), [deployment.md](deployment.md)       |
| Validated migration and bounded recovery                      | Preserve trust/counters across connectivity changes   | [flows.md](flows.md)                                       |
| Cleanup and minimal logging                                   | Limit stale secrets, resources, and retained data     | [security.md](security.md), [deployment.md](deployment.md) |
| Reject undefined key-update behavior                          | Avoid treating a type name as a secure rekey protocol | [protocol.md](protocol.md)                                 |




## 3. Open decisions


| ID  | Question                              | Required specification                                                                 |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| O01 | Extend current native WebRTC or adopt custom UDP for the target? | Expo/Go component mapping; browser work remains deferred |
| O02 | How is the intended peer key trusted? | Enrollment, first contact, verification, key changes, recovery, revocation, guests     |
| O03 | Which authenticated protocol profile? | Pattern, algorithms, library, roles, context binding, key confirmation, review         |
| O04 | Exact packet encoding?                | Widths, byte order, lengths, versions, limits, test vectors                            |
| O05 | Nonce/counter/replay representation?  | Domain mapping, concurrency, window, forward-jump policy, exhaustion                   |
| O06 | Key updates supported?                | Reviewed epoch/update protocol or reconnect-before-limits policy                       |
| O07 | Signaling and admission protocol?     | API schemas, authentication, consent, expiry, abuse controls                           |
| O08 | Relay implementation?                 | Protocol/provider, credentials, route binding, transports, quotas, failures            |
| O09 | Path validation/migration?            | Reachability proof, amplification limits, address-change rules, recovery budgets       |
| O10 | Audio/congestion profile?             | Opus parameters, timing, loss, buffers, pacing/congestion behavior                     |
| O11 | Essential controls under UDP loss?    | Retry/idempotency without nonce reuse for distinct plaintext                           |
| O12 | Precise privacy claims?               | Threat model, signaling/candidate policy, negotiation, visibility, mode changes        |
| O13 | Multi-hop actually supported?         | Selected topology/protocol, collusion assumptions, verification; otherwise unavailable |
| O14 | What data persists?                   | Storage schema, identity protection, retention, access, deletion                       |


These decisions block claims of a complete interoperable or production-ready protocol, not sharing this proposal.

## 4. Implementation order

1. Resolve platform and intended-peer trust model.
2. Select a reviewed authenticated protocol/library and define its application profile.
3. Specify admission, consent, privacy, session context, and signaling schemas.
4. Define datagram encoding, nonce domains, replay behavior, and state permissions.
5. Build and verify bounded receive validation before connecting the decoder.
6. Add direct path validation, Opus pipelines, buffers, and congestion behavior.
7. Add authorized relay forwarding and privacy enforcement from discovery onward.
8. Add recovery, cleanup, monitoring, and reviewed migration/rekey support if selected.
9. Complete interoperability tests and security review before release claims.



## 5. Acceptance checklist



### Trust and setup

- [ ] Room code alone cannot authorize participation or establish identity.
- [ ] Unauthorized joins are rejected before sensitive peer metadata is disclosed.
- [ ] Substituted/changed peer keys invoke the defined trust policy.
- [ ] Tampering with bound version, roles, privacy, or session context fails authentication.
- [ ] Voice requires consent, peer authentication, and a validated usable path.
- [ ] Authentication failure never causes weaker-protocol fallback.



### Packet boundary

- [ ] Invalid lengths, headers, sessions, or tags cannot reach the decoder.
- [ ] Protected-header tampering causes rejection.
- [ ] Valid duplicates are processed at most once, including concurrent arrivals.
- [ ] Reordered packets are admitted only inside the configured replay policy.
- [ ] Forged high numbers cannot advance replay state.
- [ ] Reflected reverse-direction packets fail under directional keys.
- [ ] Unknown types, invalid frames, and state-forbidden actions are rejected.
- [ ] Fuzzing/resource tests cover unauthenticated input and authenticated malicious peers.



### Keys and lifecycle

- [ ] Fresh sessions use fresh ephemeral material and correct directional mappings.
- [ ] No key/nonce pair is reused across voice, control, or streams.
- [ ] Retries, migration, recovery, and restart preserve nonce safety.
- [ ] Usage limits trigger reviewed renewal or re-establishment before exhaustion.
- [ ] Teardown releases audio, sockets, buffers, allocations, and transient secrets.
- [ ] Lost termination messages and vanished peers have bounded cleanup.



### Connectivity and privacy

- [ ] Direct IPv6 voice carries no media through rendezvous/relay.
- [ ] Direct failure invokes only configured normal-mode fallback.
- [ ] Relays never receive media keys or plaintext audio.
- [ ] IP-hidden mode exposes no direct endpoints through signaling and sends no direct probes.
- [ ] Relay failure in IP-hidden mode never triggers direct fallback.
- [ ] Mode changes do not claim to undo previously disclosed endpoints.
- [ ] A copied connection ID/new source address alone cannot migrate a session.
- [ ] Loss, delay, reordering, address changes, and outages have bounded recovery behavior.



### Operations and published claims

- [ ] Floods cannot cause unbounded allocations, logs, queues, or responses.
- [ ] Congestion behavior, datagram size, and buffering are tested on representative paths.
- [ ] Logs exclude audio plaintext, secrets, tokens, and unnecessary identifying data.
- [ ] Selected choices replace open questions in a versioned protocol profile.
- [ ] Documentation distinguishes proposed, implemented, and verified behavior.



## 6. Source traceability


| Source section               | Expanded documentation                                                   |
| ---------------------------- | ------------------------------------------------------------------------ |
| 1. Trust before voice path   | [system.md](system.md), [flows.md](flows.md), [security.md](security.md) |
| 2. Cryptographic session     | [protocol.md](protocol.md), [security.md](security.md)                   |
| 3. Voice encoding/encryption | [system.md](system.md), [flows.md](flows.md)                             |
| 4. Packet structure          | [protocol.md](protocol.md)                                               |
| 5. Validation wall           | [flows.md](flows.md), [protocol.md](protocol.md)                         |
| 6. Replay protection         | [flows.md](flows.md), [protocol.md](protocol.md)                         |
| 7. Direction separation      | [protocol.md](protocol.md), [security.md](security.md)                   |
| 8. Voice/control separation  | [protocol.md](protocol.md)                                               |
| 9. Endpoint protection       | [security.md](security.md), [deployment.md](deployment.md)               |
| 10. MITM model               | [security.md](security.md)                                               |
| 11. Direct-first/privacy     | [flows.md](flows.md), [security.md](security.md)                         |
| 12. Final architecture       | [system.md](system.md)                                                   |




## 7. External references

These support specification work; citing them does not certify the project.

- [Noise Protocol Framework](https://noiseprotocol.org/noise.html): authenticated patterns, application responsibilities, transport considerations.
- [RFC 5116](https://www.rfc-editor.org/rfc/rfc5116): AEAD, associated data, nonce requirements.
- [RFC 8085](https://www.rfc-editor.org/rfc/rfc8085): UDP congestion and datagram-sizing responsibilities.
