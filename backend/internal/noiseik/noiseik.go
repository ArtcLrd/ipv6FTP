// Package noiseik implements the Noise_IK_25519_ChaChaPoly_SHA256 handshake used for
// device-possession enrollment and recovery (user-management plan section B).
//
// It is deliberately small and dependency-free beyond the already pinned
// golang.org/x/crypto (ChaCha20-Poly1305) and the standard library (X25519, SHA-256,
// HMAC). It is checked against the official noise-c test vector in
// testdata/noise; see noiseik_test.go.
//
// Pattern (Noise spec rev 34):
//
//	<- s
//	...
//	-> e, es, s, ss
//	<- e, ee, se
//
// The initiator (phone) already knows the responder's (server's) static key, so the
// phone's static key travels encrypted in the first message and the server learns it
// only after authenticating to the phone. Replay protection is NOT part of Noise IK:
// callers must bind a fresh server challenge into the prologue (see Prologue).
package noiseik

import (
	"crypto/ecdh"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"errors"

	"golang.org/x/crypto/chacha20poly1305"
)

const (
	// ProtocolName is the exact Noise protocol name; it seeds the handshake hash.
	ProtocolName = "Noise_IK_25519_ChaChaPoly_SHA256"

	KeySize       = 32
	TagSize       = chacha20poly1305.Overhead
	MaxMessage    = 65535 // Noise limit for any single message
	hashSize      = sha256.Size
	maxPrologue   = 1024
	message1Fixed = KeySize + (KeySize + TagSize) + TagSize // e || enc(s) || enc(empty payload)
	message2Fixed = KeySize + TagSize                       // e || enc(empty payload)
)

var (
	ErrMessageLength = errors.New("noiseik: bad message length")
	ErrDecrypt       = errors.New("noiseik: authentication failed")
	ErrState         = errors.New("noiseik: handshake step out of order")
	ErrKey           = errors.New("noiseik: invalid key")
	ErrPrologue      = errors.New("noiseik: prologue too long")
	ErrNonceExhaust  = errors.New("noiseik: nonce space exhausted")
	ErrLowOrder      = errors.New("noiseik: rejected degenerate public key")
)

// ---- primitives ----

func hashOf(parts ...[]byte) []byte {
	h := sha256.New()
	for _, p := range parts {
		h.Write(p)
	}
	return h.Sum(nil)
}

func hmacSHA256(key []byte, data ...[]byte) []byte {
	m := hmac.New(sha256.New, key)
	for _, d := range data {
		m.Write(d)
	}
	return m.Sum(nil)
}

// hkdf2 is Noise's HKDF producing two outputs.
func hkdf2(ck, ikm []byte) (out1, out2 []byte) {
	temp := hmacSHA256(ck, ikm)
	out1 = hmacSHA256(temp, []byte{0x01})
	out2 = hmacSHA256(temp, out1, []byte{0x02})
	return
}

func dh(priv *ecdh.PrivateKey, pub *ecdh.PublicKey) ([]byte, error) {
	secret, err := priv.ECDH(pub)
	if err != nil {
		// crypto/ecdh already rejects an all-zero shared secret (low-order points).
		return nil, ErrLowOrder
	}
	return secret, nil
}

func parsePublic(b []byte) (*ecdh.PublicKey, error) {
	if len(b) != KeySize {
		return nil, ErrKey
	}
	k, err := ecdh.X25519().NewPublicKey(b)
	if err != nil {
		return nil, ErrKey
	}
	return k, nil
}

// ---- cipher state ----

// CipherState is one direction of the transport after the handshake.
type CipherState struct {
	k [KeySize]byte
	n uint64
	// has distinguishes "no key yet" (handshake) from a keyed state.
	has bool
}

func (c *CipherState) setKey(k []byte) {
	copy(c.k[:], k)
	c.n = 0
	c.has = true
}

func (c *CipherState) nonce() ([12]byte, error) {
	var nonce [12]byte
	if c.n == ^uint64(0) { // 2^64-1 is reserved by the Noise spec
		return nonce, ErrNonceExhaust
	}
	binary.LittleEndian.PutUint64(nonce[4:], c.n)
	return nonce, nil
}

func (c *CipherState) encrypt(ad, plaintext []byte) ([]byte, error) {
	if !c.has {
		return append([]byte(nil), plaintext...), nil
	}
	nonce, err := c.nonce()
	if err != nil {
		return nil, err
	}
	aead, err := chacha20poly1305.New(c.k[:])
	if err != nil {
		return nil, err
	}
	c.n++
	return aead.Seal(nil, nonce[:], plaintext, ad), nil
}

func (c *CipherState) decrypt(ad, ciphertext []byte) ([]byte, error) {
	if !c.has {
		return append([]byte(nil), ciphertext...), nil
	}
	nonce, err := c.nonce()
	if err != nil {
		return nil, err
	}
	aead, err := chacha20poly1305.New(c.k[:])
	if err != nil {
		return nil, err
	}
	pt, err := aead.Open(nil, nonce[:], ciphertext, ad)
	if err != nil {
		// The counter only advances on success so a forged frame cannot desync the stream.
		return nil, ErrDecrypt
	}
	c.n++
	return pt, nil
}

// Encrypt seals one transport message. The additional data is empty.
func (c *CipherState) Encrypt(plaintext []byte) ([]byte, error) {
	if len(plaintext)+TagSize > MaxMessage {
		return nil, ErrMessageLength
	}
	return c.encrypt(nil, plaintext)
}

// Decrypt opens one transport message.
func (c *CipherState) Decrypt(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) < TagSize || len(ciphertext) > MaxMessage {
		return nil, ErrMessageLength
	}
	return c.decrypt(nil, ciphertext)
}

// Transport is the result of a completed handshake.
type Transport struct {
	// Send encrypts messages this side sends; Recv decrypts messages from the peer.
	Send, Recv CipherState
	// Hash is the final handshake hash, usable as a channel binding value.
	Hash []byte
}

// ---- symmetric state ----

type symmetric struct {
	ck, h []byte
	c     CipherState
}

func newSymmetric(prologue []byte) *symmetric {
	// The protocol name is exactly 32 bytes, so it is used directly as h (spec 5.2).
	h := []byte(ProtocolName)
	s := &symmetric{h: h, ck: append([]byte(nil), h...)}
	s.mixHash(prologue)
	return s
}

func (s *symmetric) mixHash(data []byte) { s.h = hashOf(s.h, data) }

func (s *symmetric) mixKey(ikm []byte) {
	ck, tempK := hkdf2(s.ck, ikm)
	s.ck = ck
	s.c.setKey(tempK)
}

func (s *symmetric) encryptAndHash(pt []byte) ([]byte, error) {
	ct, err := s.c.encrypt(s.h, pt)
	if err != nil {
		return nil, err
	}
	s.mixHash(ct)
	return ct, nil
}

func (s *symmetric) decryptAndHash(ct []byte) ([]byte, error) {
	pt, err := s.c.decrypt(s.h, ct)
	if err != nil {
		return nil, err
	}
	s.mixHash(ct)
	return pt, nil
}

func (s *symmetric) split(initiator bool) *Transport {
	k1, k2 := hkdf2(s.ck, nil)
	t := &Transport{Hash: append([]byte(nil), s.h...)}
	var c1, c2 CipherState
	c1.setKey(k1)
	c2.setKey(k2)
	if initiator {
		t.Send, t.Recv = c1, c2
	} else {
		t.Send, t.Recv = c2, c1
	}
	return t
}

// Prologue builds an unambiguous prologue from a purpose label and context parts
// (for example the setup-grant id and the server challenge nonce). Purposes keep
// enrollment and recovery handshakes from being replayed into one another. Each
// part is length-prefixed so ("ab","c") and ("a","bc") differ.
func Prologue(purpose string, parts ...[]byte) ([]byte, error) {
	out := []byte("ipv6ftp/noise-ik/v1/")
	out = append(out, purpose...)
	out = append(out, 0)
	for _, p := range parts {
		var l [2]byte
		binary.BigEndian.PutUint16(l[:], uint16(len(p)))
		out = append(out, l[:]...)
		out = append(out, p...)
	}
	if len(out) > maxPrologue {
		return nil, ErrPrologue
	}
	return out, nil
}

// stepFailed poisons a handshake after any error so a half-mutated state is never reused.
const stepFailed = -1

// ---- responder (server) ----

// Responder is the server side. Use one per handshake.
type Responder struct {
	s         *symmetric
	static    *ecdh.PrivateKey
	ephemeral *ecdh.PrivateKey // nil means a fresh random key; set only by tests
	re        *ecdh.PublicKey
	rs        *ecdh.PublicKey
	step      int
}

// NewResponder starts a handshake with the server's static key.
func NewResponder(static *ecdh.PrivateKey, prologue []byte) (*Responder, error) {
	if static == nil || static.Curve() != ecdh.X25519() {
		return nil, ErrKey
	}
	if len(prologue) > maxPrologue {
		return nil, ErrPrologue
	}
	r := &Responder{s: newSymmetric(prologue), static: static}
	r.s.mixHash(static.PublicKey().Bytes()) // pre-message "<- s"
	return r, nil
}

// ReadMessage1 consumes "-> e, es, s, ss" and returns the initiator's static public
// key (now authenticated as the sender of this message) and its payload.
func (r *Responder) ReadMessage1(msg []byte) (initiatorStatic, payload []byte, err error) {
	if r.step != 0 {
		return nil, nil, ErrState
	}
	defer func() {
		if err != nil {
			r.step = stepFailed
		}
	}()
	if len(msg) < message1Fixed || len(msg) > MaxMessage {
		return nil, nil, ErrMessageLength
	}
	re, err := parsePublic(msg[:KeySize])
	if err != nil {
		return nil, nil, err
	}
	r.s.mixHash(re.Bytes())
	es, err := dh(r.static, re)
	if err != nil {
		return nil, nil, err
	}
	r.s.mixKey(es)
	rsBytes, err := r.s.decryptAndHash(msg[KeySize : KeySize+KeySize+TagSize])
	if err != nil {
		return nil, nil, err
	}
	rs, err := parsePublic(rsBytes)
	if err != nil {
		return nil, nil, err
	}
	ss, err := dh(r.static, rs)
	if err != nil {
		return nil, nil, err
	}
	r.s.mixKey(ss)
	payload, err = r.s.decryptAndHash(msg[KeySize+KeySize+TagSize:])
	if err != nil {
		return nil, nil, err
	}
	r.re, r.rs, r.step = re, rs, 1
	return rs.Bytes(), payload, nil
}

// WriteMessage2 produces "<- e, ee, se" and completes the handshake.
func (r *Responder) WriteMessage2(payload []byte) (msg []byte, t *Transport, err error) {
	if r.step != 1 {
		return nil, nil, ErrState
	}
	defer func() {
		if err != nil {
			r.step = stepFailed
		}
	}()
	if len(payload) > MaxMessage-message2Fixed {
		return nil, nil, ErrMessageLength
	}
	e, err := genEphemeral(r.ephemeral)
	if err != nil {
		return nil, nil, err
	}
	out := append([]byte(nil), e.PublicKey().Bytes()...)
	r.s.mixHash(e.PublicKey().Bytes())
	ee, err := dh(e, r.re)
	if err != nil {
		return nil, nil, err
	}
	r.s.mixKey(ee)
	se, err := dh(e, r.rs)
	if err != nil {
		return nil, nil, err
	}
	r.s.mixKey(se)
	ct, err := r.s.encryptAndHash(payload)
	if err != nil {
		return nil, nil, err
	}
	r.step = 2
	return append(out, ct...), r.s.split(false), nil
}

// ---- initiator (phone; also used by tests) ----

// Initiator is the phone side.
type Initiator struct {
	s         *symmetric
	static    *ecdh.PrivateKey
	rs        *ecdh.PublicKey
	e         *ecdh.PrivateKey
	ephemeral *ecdh.PrivateKey
	step      int
}

// NewInitiator starts a handshake knowing the server's static public key.
func NewInitiator(static *ecdh.PrivateKey, serverStatic, prologue []byte) (*Initiator, error) {
	if static == nil || static.Curve() != ecdh.X25519() {
		return nil, ErrKey
	}
	rs, err := parsePublic(serverStatic)
	if err != nil {
		return nil, err
	}
	if len(prologue) > maxPrologue {
		return nil, ErrPrologue
	}
	i := &Initiator{s: newSymmetric(prologue), static: static, rs: rs}
	i.s.mixHash(rs.Bytes())
	return i, nil
}

// WriteMessage1 produces "-> e, es, s, ss".
func (i *Initiator) WriteMessage1(payload []byte) (msg []byte, err error) {
	if i.step != 0 {
		return nil, ErrState
	}
	defer func() {
		if err != nil {
			i.step = stepFailed
		}
	}()
	if len(payload) > MaxMessage-message1Fixed {
		return nil, ErrMessageLength
	}
	e, err := genEphemeral(i.ephemeral)
	if err != nil {
		return nil, err
	}
	i.e = e
	out := append([]byte(nil), e.PublicKey().Bytes()...)
	i.s.mixHash(e.PublicKey().Bytes())
	es, err := dh(e, i.rs)
	if err != nil {
		return nil, err
	}
	i.s.mixKey(es)
	encS, err := i.s.encryptAndHash(i.static.PublicKey().Bytes())
	if err != nil {
		return nil, err
	}
	out = append(out, encS...)
	ss, err := dh(i.static, i.rs)
	if err != nil {
		return nil, err
	}
	i.s.mixKey(ss)
	ct, err := i.s.encryptAndHash(payload)
	if err != nil {
		return nil, err
	}
	i.step = 1
	return append(out, ct...), nil
}

// ReadMessage2 consumes "<- e, ee, se" and completes the handshake.
func (i *Initiator) ReadMessage2(msg []byte) (payload []byte, t *Transport, err error) {
	if i.step != 1 {
		return nil, nil, ErrState
	}
	defer func() {
		if err != nil {
			i.step = stepFailed
		}
	}()
	if len(msg) < message2Fixed || len(msg) > MaxMessage {
		return nil, nil, ErrMessageLength
	}
	re, err := parsePublic(msg[:KeySize])
	if err != nil {
		return nil, nil, err
	}
	i.s.mixHash(re.Bytes())
	ee, err := dh(i.e, re)
	if err != nil {
		return nil, nil, err
	}
	i.s.mixKey(ee)
	se, err := dh(i.static, re)
	if err != nil {
		return nil, nil, err
	}
	i.s.mixKey(se)
	payload, err = i.s.decryptAndHash(msg[KeySize:])
	if err != nil {
		return nil, nil, err
	}
	i.step = 2
	return payload, i.s.split(true), nil
}

func genEphemeral(fixed *ecdh.PrivateKey) (*ecdh.PrivateKey, error) {
	if fixed != nil {
		return fixed, nil
	}
	return ecdh.X25519().GenerateKey(rand.Reader)
}

// Equal reports whether two keys or hashes match without leaking timing.
func Equal(a, b []byte) bool { return subtle.ConstantTimeCompare(a, b) == 1 }
