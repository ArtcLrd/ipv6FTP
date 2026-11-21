# IPv6-First Authenticated E2EE P2P Voice Architecture

A shareable design for two-party voice whose preferred media path runs directly between devices over IPv6. Rendezvous coordinates the call; end-to-end encryption protects voice on direct and relayed paths.

**Status: accepted session V2 and calling V2 plans, with remaining specification prerequisites and separate historical source evidence.** V2 consolidates the reviewed flows; exact message schemas, transition-loss behavior, library integration and validation remain engineering prerequisites. No document verifies deployment or successful physical-device tests.

## Documentation map

| File | Contents |
| --- | --- |
| [user-management-implementation-plan.md](user-management-implementation-plan.md) | D01-D17 user choices, feature/recovery behavior, engineering defaults, account contracts, migration safety and ordered milestones before remaining calling work |
| [call_implementation_proposed_v2.md](call_implementation_proposed_v2.md) | Consolidated calling implementation plan: accepted behavior, detailed flows, provisional parameters, phases and acceptance criteria |
| [current-implementation.md](current-implementation.md) | Current Expo/Go packages, registered-user and guest journeys, connection paths, and known wiring gaps |
| [session-management-proposed-v2.md](session-management-proposed-v2.md) | Accepted session plan: identity/enrollment, persistence/recovery, quotas/gates, reminders, API limits, concurrency, delivery and validation |
| [session-management.md](session-management.md) | Superseded initial session proposal/research retained for context |
| [call-peer-connection.md](call-peer-connection.md) | Superseded initial call proposal retained for reference; use V2 for current calling decisions |
| [system.md](system.md) | Whole-system architecture, components, boundaries, responsibilities, and data ownership |
| [flows.md](flows.md) | Call setup, media pipeline, replay rejection, fallback, privacy mode, recovery, and shutdown |
| [protocol.md](protocol.md) | Logical packet structure, message types, state machine, and validation rules |
| [security.md](security.md) | Trust model, threats, cryptographic requirements, endpoint protection, and privacy limits |
| [deployment.md](deployment.md) | Deployment topology, configuration, operations, and failure behavior |
| [decisions.md](decisions.md) | Design decisions, unresolved choices, implementation order, and acceptance checklist |
| [source-notes.md](source-notes.md) | Unmodified source text supplied for this documentation |

Start with **system.md** for the canonical overview and **call_implementation_proposed_v2.md** for the current calling plan. Read **session-management-proposed-v2.md** for the accepted identity/session plan, then calling V2 to assemble the complete lifecycle. **session-management.md** is superseded research. **call-peer-connection.md** is superseded; **current-implementation.md** is the historical September source baseline. Neither is current runtime verification. Mermaid diagrams are also explained in prose/tables.

## Scope and conventions

- **Source requirement:** behavior explicitly described in the supplied notes.
- **Proposed completion:** detail added to make the design implementable and reviewable; still needs implementation review.
- **Open decision:** a choice that must be resolved before interoperability or security can be claimed.

The target scope is two-party voice. The current implementation baseline also traces account/guest identity and contact discovery because they lead into call setup. File transfer, billing, recording, and group calls remain outside this review. A blind relay is an optional target fallback. Multi-hop routing is a future option with no selected protocol.

The central rule is: **reaching a device's IPv6 endpoint does not grant application-level trust.** Authentication, replay checks, frame validation, and state authorization precede decoding.

## Relationship to this repository

A limited source inspection on 2026-09-19 found `RTCPeerConnection` in `frontend-web/src/hooks/useWebRTC.js`, browser audio tracks in `frontend-web/src/hooks/useVoice.js`, and STUN/TURN configuration with `iceTransportPolicy: "all"` in `frontend-web/src/lib/iceConfig.js`.

The Expo app also uses `react-native-webrtc` in `frontend/src/modules/call/webrtc.ts`. Active development currently targets that Expo app and the Go backend; the separate web app is deferred until the user explicitly starts its development phase.

The September observations are historical. Newer working-tree code contains partial native Noise/direct-IPv6 calling. The lifecycle proposals select that direction for first delivery; exact protocol and operational choices remain in [decisions.md](decisions.md). No successful deployment or device test is implied.

## Keeping the design current

Every future architecture change must update [system.md](system.md) and the affected current-implementation, session-management, flow, protocol, security, deployment, and decision documents in the same change. Keep registered-user and guest journeys current, keep diagrams and prose aligned, and distinguish proposed behavior from implemented and verified behavior. A task is not complete until that documentation impact has been checked.

The Expo UI brief `frontend/design.md` is maintained separately when UI requirements change. Keep [source-notes.md](source-notes.md) unchanged as the original historical input. Repository agent instructions enforce this workflow; these Markdown files do not automatically regenerate themselves.

## Sharing

Upload this entire `voice-architecture` folder to GitHub, either inside the project or as a standalone documentation repository. All documentation links stay inside the folder; diagrams require no image files. The original notes are included for traceability.

## Terms

| Term | Meaning |
| --- | --- |
| E2EE | End-to-end encryption; participating endpoints hold media decryption keys |
| Rendezvous | Discovery, authorization, and signaling coordination |
| Signaling | Messages used to establish and manage a call |
| Media plane | Path carrying encoded, encrypted voice |
| AEAD | Authenticated encryption with associated data |
| AAD | Cleartext metadata authenticated by AEAD |
| Transcript | Ordered handshake messages and bound session context |
| Replay window | Receiver state rejecting duplicate or sufficiently old packet numbers |
| Epoch | Proposed identifier for a generation of traffic keys |
| Blind relay | Service forwarding ciphertext without media decryption keys |
