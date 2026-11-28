# IPv6 Direct P2P Secure Voice Architecture

```
                         ┌─────────────────────────┐
                         │   RENDEZVOUS SERVER     │
                         │                         │
                         │ Session discovery       │
                         │ Authentication          │
                         │ Key-exchange signaling  │
                         │ Connectivity metadata   │
                         │                         │
                         │ NO VOICE MEDIA          │
                         └────────────┬────────────┘
                                      │
                         authenticated rendezvous
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
                    ▼                                   ▼
              ┌───────────┐                       ┌───────────┐
              │  USER A   │                       │  USER B   │
              │           │                       │           │
              │ Identity  │                       │ Identity  │
              │ Key       │                       │ Key       │
              │     +     │                       │     +     │
              │ Ephemeral │                       │ Ephemeral │
              │ X25519    │                       │ X25519    │
              └─────┬─────┘                       └─────┬─────┘
                    │                                   │
                    │        AUTHENTICATED              │
                    │        KEY EXCHANGE               │
                    │                                   │
                    └──────────────┬────────────────────┘
                                   │
                                   ▼
                         ┌──────────────────┐
                         │ Session Key      │
                         │ Derivation       │
                         │                  │
                         │ X25519           │
                         │ HKDF             │
                         │ Transcript bind  │
                         └────────┬─────────┘
                                  │
                       Direction-specific keys
                                  │
                 ┌────────────────┴────────────────┐
                 │                                 │
                 ▼                                 ▼
          A → B Session Key                  B → A Session Key
                 │                                 │
                 └────────────────┬────────────────┘
                                  │
                                  ▼

          ╔══════════════════════════════════════════════════╗
          ║              DIRECT IPv6 MEDIA PATH             ║
          ║                                                  ║
          ║  USER A                               USER B    ║
          ║    │                                      │     ║
          ║    │  Encoded Voice                       │     ║
          ║    │       ↓                              │     ║
          ║    │  AEAD Encryption                     │     ║
          ║    │       ↓                              │     ║
          ║    │  Authenticated Frame                 │     ║
          ║    │       ↓                              │     ║
          ║    ╰══════════ IPv6 / UDP ════════════════►│     ║
          ║                                      ↓           ║
          ║                                AEAD Verify      ║
          ║                                      ↓           ║
          ║                                Replay Check     ║
          ║                                      ↓           ║
          ║                                Frame Validate   ║
          ║                                      ↓           ║
          ║                                Audio Decode     ║
          ║                                                  ║
          ╚══════════════════════════════════════════════════╝
```

## 1. Establish trust before establishing the voice path

Don't do:

```
Room Code
   ↓
Exchange IPs
   ↓
Open socket
   ↓
Trust peer
```

Use:

```
Room Code
   ↓
Join request
   ↓
Session authentication
   ↓
Ephemeral key exchange
   ↓
Transcript authentication
   ↓
Session established
   ↓
Direct IPv6 connection
```

The room code should identify a **session**, not act as the cryptographic secret.

---

# 2. Cryptographic session

Each participant has:

```
Long-term identity key
        +
Ephemeral X25519 key
```

Conceptually:

```
A                               B

Identity_A                      Identity_B
    │                               │
Ephemeral_A                    Ephemeral_B
    │                               │
    └────── authenticated ──────────┘
              exchange
                   │
              X25519 DH
                   │
                  HKDF
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
     A → B key             B → A key
```

Bind the key derivation to the authenticated transcript so an attacker cannot silently substitute session parameters.

For implementation, use a **well-reviewed authenticated Noise protocol pattern or equivalent established protocol construction** rather than inventing your own authentication scheme.

---

# 3. Voice encoding → encryption

The voice pipeline should be:

```
Microphone
    │
    ▼
Audio capture
    │
    ▼
Opus encoder
    │
    ▼
Voice frame
    │
    ▼
Sequence / packet number
    │
    ▼
AEAD encryption
    │
    ▼
IPv6 / UDP
    │
    ▼
Internet
```

On B:

```
IPv6 / UDP
    │
    ▼
Packet validation
    │
    ▼
AEAD authentication
    │
    ▼
Replay protection
    │
    ▼
Frame validation
    │
    ▼
Opus decoder
    │
    ▼
Speaker
```

**Never decode before authentication.**

---

# 4. Recommended packet structure

Conceptually:

```
┌───────────────────────────────────────┐
│ Transport Header                     │
├───────────────────────────────────────┤
│ Protocol Version                     │
│ Connection ID                        │
│ Packet Number                        │
│ Stream ID                            │
│ Frame Type                           │
│ Ciphertext Length                    │
├───────────────────────────────────────┤
│                                       │
│        Encrypted Voice Payload        │
│                                       │
├───────────────────────────────────────┤
│        AEAD Authentication Tag        │
└───────────────────────────────────────┘
```

The header can contain information necessary for routing and replay handling, but avoid putting unnecessary identity or application metadata into every packet.

---

# 5. The critical packet-validation wall

This is the part that addresses your concern about a malicious packet that looks exactly like an application packet.

```
                 ANY INTERNET PACKET
                         │
                         ▼
                ┌─────────────────┐
                │ IPv6 / UDP      │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Basic bounds /  │
                │ format checks   │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Session lookup  │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ AEAD Verify     │
                │                 │
                │ Is tag valid?   │
                └───────┬─────────┘
                    NO  │  YES
                   ┌────┘   └─────┐
                   ▼              ▼
                 DROP       Replay/sequence
                              validation
                                  │
                                  ▼
                         Message-type validation
                                  │
                                  ▼
                           Protocol state check
                                  │
                                  ▼
                           Authorized operation
                                  │
                                  ▼
                            Audio decoder
```

An attacker can copy:

```
Version
Connection ID
Packet format
Frame type
Length
```

but without the appropriate session key they cannot create a valid AEAD authentication tag.

---

# 6. Protect against replay

Suppose a legitimate packet is:

```
Packet #1842
```

An attacker captures it and retransmits it.

Your receiver should recognize:

```
1842 already processed
        ↓
       DROP
```

Use a packet-number/sequence-number scheme with an appropriate replay window.

Do not rely solely on timestamps.

---

# 7. Protect both directions separately

Use separate cryptographic domains:

```
               Session Secret
                     │
                    HKDF
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
       A → B                   B → A
        Key                     Key
```

This prevents accidental cross-direction key reuse and makes protocol reasoning cleaner.

---

# 8. Separate voice from control messages

Don't make everything simply:

```
encrypted bytes → application
```

Define explicit message types.

For example:

```
VOICE_FRAME
PING
PONG
CALL_ACCEPT
CALL_END
KEY_UPDATE
```

Then:

```
Unknown message type
        ↓
       DROP
```

And enforce state:

```
CONNECTED
   │
   ├── VOICE_FRAME       ✓
   ├── PING              ✓
   ├── CALL_END          ✓
   └── arbitrary command ✗
```

There should be **no generic remote-command capability** in the voice protocol.

---

# 9. IPv6 endpoint protection

Your direct P2P design necessarily means:

```
A knows B's current endpoint
B knows A's current endpoint
```

That's not a cryptographic vulnerability; it's a consequence of direct IP networking.

Therefore protect the endpoint itself with:

```
IPv6 host firewall
        +
minimal listening ports
        +
application authentication
        +
rate limiting
        +
strict protocol parsing
```

The application should not expose unrelated services merely because IPv6 makes the device globally reachable.

---

# 10. MITM model

Your desired result is:

```
             MITM
              │
       ┌──────┴──────┐
       │             │
       ▼             ▼
      A ═══════════ B
          E2EE
```

The attacker can potentially observe/modify/drop traffic at the network layer, but:

```
Capture ciphertext       → cannot decrypt
Modify ciphertext        → AEAD fails
Forge voice frame        → AEAD fails
Forge authenticated ACK  → AEAD fails
Replay old frame         → sequence/replay check fails
Send random packet       → authentication fails
```

However:

```
Drop packets             → possible
Delay packets            → possible
Flood endpoint           → possible
Exploit implementation   → possible if a software vulnerability exists
Compromise endpoint      → E2EE cannot prevent
```

Therefore your security objective should be:

> **A network attacker must not gain application-level trust merely by reaching the IPv6 endpoint.**
> 

---

# 11. Direct P2P should remain your default

For your project:

```
                    CALL START
                        │
                        ▼
                 Authenticate
                        │
                        ▼
                 Key agreement
                        │
                        ▼
              Direct IPv6 available?
                    /        \
                  YES         NO
                   │           │
                   ▼           ▼
             DIRECT P2P    Blind Relay
               + E2EE        + E2EE
```

But if the user explicitly chooses **anonymous/IP-hidden mode**:

```
Privacy Mode
     │
     ▼
DO NOT attempt Direct P2P
     │
     ▼
Blind Relay / Multi-Hop
```

That prevents the privacy mode from accidentally exposing an endpoint during direct negotiation.

---

# 12. Final architecture for your project

I would name the architecture:

## **IPv6-First Authenticated E2EE P2P Voice Architecture**

with these layers:

```
┌────────────────────────────────────────────┐
│              Voice Application             │
│       Capture / Encode / Playback          │
├────────────────────────────────────────────┤
│              Secure Session                │
│  Authenticated handshake / X25519 / HKDF  │
├────────────────────────────────────────────┤
│              E2EE Media                    │
│       AEAD / sequence / replay            │
├────────────────────────────────────────────┤
│             P2P Transport                  │
│        Connection ID / migration           │
├────────────────────────────────────────────┤
│          Adaptive Network Layer            │
│ Direct IPv6 │ Blind Relay │ Multi-Hop      │
├────────────────────────────────────────────┤
│                IPv6                        │
└────────────────────────────────────────────┘
```

### Your primary path

**Microphone → Opus → AEAD → UDP/IPv6 → B → AEAD → Opus → Speaker**

### Your security boundary

**AEAD authentication + replay protection + protocol authorization before decoding/processing.**

### Your project USP

**The normal voice media path is genuinely device-to-device over IPv6, with the server removed from the media plane.**