package noiseik

import (
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

type vectorMsg struct {
	Payload    string `json:"payload"`
	Ciphertext string `json:"ciphertext"`
}

type vector struct {
	Name          string      `json:"name"`
	InitPrologue  string      `json:"init_prologue"`
	InitStatic    string      `json:"init_static"`
	InitEphemeral string      `json:"init_ephemeral"`
	InitRemote    string      `json:"init_remote_static"`
	RespPrologue  string      `json:"resp_prologue"`
	RespStatic    string      `json:"resp_static"`
	RespEphemeral string      `json:"resp_ephemeral"`
	Messages      []vectorMsg `json:"messages"`
	HandshakeHash string      `json:"handshake_hash"`
}

func unhex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func priv(t *testing.T, s string) *ecdh.PrivateKey {
	t.Helper()
	k, err := ecdh.X25519().NewPrivateKey(unhex(t, s))
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func loadVector(t *testing.T) vector {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/noise/IK_25519_ChaChaPoly_SHA256.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Vector vector `json:"vector"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if f.Vector.Name != ProtocolName {
		t.Fatalf("vector is for %q, code is %q", f.Vector.Name, ProtocolName)
	}
	return f.Vector
}

// TestOfficialVector replays the noise-c reference vector byte for byte, which
// pins the pattern, HKDF, nonce format, AD handling and split to the same
// construction noise-java (the phone's library) implements.
func TestOfficialVector(t *testing.T) {
	v := loadVector(t)
	init, err := NewInitiator(priv(t, v.InitStatic), unhex(t, v.InitRemote), unhex(t, v.InitPrologue))
	if err != nil {
		t.Fatal(err)
	}
	init.ephemeral = priv(t, v.InitEphemeral)
	resp, err := NewResponder(priv(t, v.RespStatic), unhex(t, v.RespPrologue))
	if err != nil {
		t.Fatal(err)
	}
	resp.ephemeral = priv(t, v.RespEphemeral)

	msg1, err := init.WriteMessage1(unhex(t, v.Messages[0].Payload))
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(msg1) != v.Messages[0].Ciphertext {
		t.Fatalf("message 1 differs from the reference\n got %x\nwant %s", msg1, v.Messages[0].Ciphertext)
	}
	peer, payload, err := resp.ReadMessage1(msg1)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(peer, priv(t, v.InitStatic).PublicKey().Bytes()) || !bytes.Equal(payload, unhex(t, v.Messages[0].Payload)) {
		t.Fatal("responder learned the wrong initiator key or payload")
	}
	msg2, rt, err := resp.WriteMessage2(unhex(t, v.Messages[1].Payload))
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(msg2) != v.Messages[1].Ciphertext {
		t.Fatalf("message 2 differs from the reference\n got %x\nwant %s", msg2, v.Messages[1].Ciphertext)
	}
	got2, it, err := init.ReadMessage2(msg2)
	if err != nil || !bytes.Equal(got2, unhex(t, v.Messages[1].Payload)) {
		t.Fatalf("initiator read: %v", err)
	}
	if hex.EncodeToString(it.Hash) != v.HandshakeHash || hex.EncodeToString(rt.Hash) != v.HandshakeHash {
		t.Fatalf("handshake hash %x / %x, want %s", it.Hash, rt.Hash, v.HandshakeHash)
	}
	// Remaining vector messages alternate initiator, responder, ...
	for i, m := range v.Messages[2:] {
		pt := unhex(t, m.Payload)
		sender, receiver := &it.Send, &rt.Recv
		if i%2 == 1 {
			sender, receiver = &rt.Send, &it.Recv
		}
		ct, err := sender.Encrypt(pt)
		if err != nil {
			t.Fatal(err)
		}
		if hex.EncodeToString(ct) != m.Ciphertext {
			t.Fatalf("transport message %d differs from the reference", i)
		}
		back, err := receiver.Decrypt(ct)
		if err != nil || !bytes.Equal(back, pt) {
			t.Fatalf("transport message %d did not round trip: %v", i, err)
		}
	}
}

func handshakePair(t *testing.T, prologue []byte) (*Initiator, *Responder, []byte) {
	t.Helper()
	server, _ := ecdh.X25519().GenerateKey(rand.Reader)
	phone, _ := ecdh.X25519().GenerateKey(rand.Reader)
	init, err := NewInitiator(phone, server.PublicKey().Bytes(), prologue)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := NewResponder(server, prologue)
	if err != nil {
		t.Fatal(err)
	}
	return init, resp, phone.PublicKey().Bytes()
}

func TestRandomRoundTripAndKeyDirections(t *testing.T) {
	pro, _ := Prologue("enroll", []byte("grant-1"), []byte("nonce-1"))
	init, resp, phonePub := handshakePair(t, pro)
	m1, err := init.WriteMessage1([]byte("hello server"))
	if err != nil {
		t.Fatal(err)
	}
	peer, p1, err := resp.ReadMessage1(m1)
	if err != nil || !bytes.Equal(peer, phonePub) || string(p1) != "hello server" {
		t.Fatalf("%v %x %q", err, peer, p1)
	}
	m2, rt, err := resp.WriteMessage2([]byte("hello phone"))
	if err != nil {
		t.Fatal(err)
	}
	p2, it, err := init.ReadMessage2(m2)
	if err != nil || string(p2) != "hello phone" {
		t.Fatalf("%v %q", err, p2)
	}
	ct, _ := it.Send.Encrypt([]byte("a"))
	if _, err := it.Recv.Decrypt(ct); err == nil {
		t.Fatal("a side decrypted its own outgoing frame")
	}
	if pt, err := rt.Recv.Decrypt(ct); err != nil || string(pt) != "a" {
		t.Fatalf("%v", err)
	}
}

func TestEveryBitFlipInMessage1IsRejected(t *testing.T) {
	pro, _ := Prologue("enroll", []byte("g"))
	init, _, _ := handshakePair(t, pro)
	m1, err := init.WriteMessage1([]byte("payload"))
	if err != nil {
		t.Fatal(err)
	}
	// Rebuild a fresh responder for each mutation: same server key, same prologue.
	server, _ := ecdh.X25519().GenerateKey(rand.Reader)
	phone, _ := ecdh.X25519().GenerateKey(rand.Reader)
	good, _ := NewInitiator(phone, server.PublicKey().Bytes(), pro)
	m1, _ = good.WriteMessage1([]byte("payload"))
	for i := range m1 {
		bad := append([]byte(nil), m1...)
		bad[i] ^= 0x01
		r, _ := NewResponder(server, pro)
		if _, _, err := r.ReadMessage1(bad); err == nil {
			t.Fatalf("flipping byte %d was accepted", i)
		}
	}
	r, _ := NewResponder(server, pro)
	if _, _, err := r.ReadMessage1(m1); err != nil {
		t.Fatalf("control: %v", err)
	}
}

func TestPrologueBindsTheHandshake(t *testing.T) {
	server, _ := ecdh.X25519().GenerateKey(rand.Reader)
	phone, _ := ecdh.X25519().GenerateKey(rand.Reader)
	a, _ := Prologue("enroll", []byte("grant"), []byte("nonce-A"))
	b, _ := Prologue("enroll", []byte("grant"), []byte("nonce-B"))
	recov, _ := Prologue("recover", []byte("grant"), []byte("nonce-A"))
	init, _ := NewInitiator(phone, server.PublicKey().Bytes(), a)
	m1, _ := init.WriteMessage1(nil)
	for name, pro := range map[string][]byte{"other nonce (replay)": b, "other purpose": recov, "empty": nil} {
		r, _ := NewResponder(server, pro)
		if _, _, err := r.ReadMessage1(m1); err == nil {
			t.Errorf("%s: handshake accepted under a different prologue", name)
		}
	}
	r, _ := NewResponder(server, a)
	if _, _, err := r.ReadMessage1(m1); err != nil {
		t.Fatalf("control: %v", err)
	}
}

func TestPrologueIsUnambiguousAndBounded(t *testing.T) {
	x, _ := Prologue("p", []byte("ab"), []byte("c"))
	y, _ := Prologue("p", []byte("a"), []byte("bc"))
	if bytes.Equal(x, y) {
		t.Fatal("prologue parts are ambiguous")
	}
	if _, err := Prologue("p", make([]byte, 2000)); err != ErrPrologue {
		t.Fatalf("oversize prologue: %v", err)
	}
}

func TestWrongServerKeyFailsAtResponder(t *testing.T) {
	realServer, _ := ecdh.X25519().GenerateKey(rand.Reader)
	other, _ := ecdh.X25519().GenerateKey(rand.Reader)
	phone, _ := ecdh.X25519().GenerateKey(rand.Reader)
	init, _ := NewInitiator(phone, other.PublicKey().Bytes(), nil) // phone pinned the wrong key
	m1, _ := init.WriteMessage1(nil)
	r, _ := NewResponder(realServer, nil)
	if _, _, err := r.ReadMessage1(m1); err == nil {
		t.Fatal("responder accepted a handshake addressed to a different static key")
	}
}

func TestMalformedLengthsAndKeys(t *testing.T) {
	server, _ := ecdh.X25519().GenerateKey(rand.Reader)
	fresh := func() *Responder { r, _ := NewResponder(server, nil); return r }
	for _, n := range []int{0, 1, 31, 32, message1Fixed - 1} {
		if _, _, err := fresh().ReadMessage1(make([]byte, n)); err != ErrMessageLength {
			t.Errorf("length %d: %v", n, err)
		}
	}
	if _, _, err := fresh().ReadMessage1(make([]byte, MaxMessage+1)); err != ErrMessageLength {
		t.Errorf("oversize: %v", err)
	}
	// An all-zero ephemeral is a low-order point and must be rejected before any decryption.
	if _, _, err := fresh().ReadMessage1(make([]byte, message1Fixed)); err == nil {
		t.Error("low-order ephemeral accepted")
	}
	if _, err := NewInitiator(nil, server.PublicKey().Bytes(), nil); err != ErrKey {
		t.Errorf("nil static: %v", err)
	}
	phone, _ := ecdh.X25519().GenerateKey(rand.Reader)
	if _, err := NewInitiator(phone, make([]byte, 31), nil); err != ErrKey {
		t.Errorf("short server key: %v", err)
	}
	p256, _ := ecdh.P256().GenerateKey(rand.Reader)
	if _, err := NewResponder(p256, nil); err != ErrKey {
		t.Errorf("wrong curve: %v", err)
	}
}

func TestStepOrderAndPoisoningAfterFailure(t *testing.T) {
	pro := []byte("p")
	init, resp, _ := handshakePair(t, pro)
	if _, _, err := resp.WriteMessage2(nil); err != ErrState {
		t.Fatalf("write before read: %v", err)
	}
	if _, _, err := init.ReadMessage2(make([]byte, 80)); err != ErrState {
		t.Fatalf("read before write: %v", err)
	}
	m1, _ := init.WriteMessage1(nil)
	if _, err := init.WriteMessage1(nil); err != ErrState {
		t.Fatalf("second write: %v", err)
	}
	bad := append([]byte(nil), m1...)
	bad[len(bad)-1] ^= 1
	if _, _, err := resp.ReadMessage1(bad); err == nil {
		t.Fatal("tampered message accepted")
	}
	// Even the genuine message must not revive a handshake that already failed.
	if _, _, err := resp.ReadMessage1(m1); err != ErrState {
		t.Fatalf("handshake reused after failure: %v", err)
	}
}

func TestForgedTransportFrameDoesNotAdvanceTheCounter(t *testing.T) {
	init, resp, _ := handshakePair(t, nil)
	m1, _ := init.WriteMessage1(nil)
	if _, _, err := resp.ReadMessage1(m1); err != nil {
		t.Fatal(err)
	}
	m2, rt, _ := resp.WriteMessage2(nil)
	_, it, _ := init.ReadMessage2(m2)
	good, _ := it.Send.Encrypt([]byte("one"))
	forged := append([]byte(nil), good...)
	forged[0] ^= 1
	if _, err := rt.Recv.Decrypt(forged); err == nil {
		t.Fatal("forged frame accepted")
	}
	if pt, err := rt.Recv.Decrypt(good); err != nil || string(pt) != "one" {
		t.Fatalf("stream desynchronised by a forgery: %v", err)
	}
	if _, err := rt.Recv.Decrypt(good); err == nil {
		t.Fatal("replayed frame accepted")
	}
	if _, err := rt.Recv.Decrypt(make([]byte, TagSize-1)); err != ErrMessageLength {
		t.Fatalf("short frame: %v", err)
	}
	if _, err := it.Send.Encrypt(make([]byte, MaxMessage)); err != ErrMessageLength {
		t.Fatalf("oversize plaintext: %v", err)
	}
}

func TestNonceExhaustionStopsTheStream(t *testing.T) {
	var c CipherState
	c.setKey(make([]byte, KeySize))
	c.n = ^uint64(0)
	if _, err := c.Encrypt([]byte("x")); err != ErrNonceExhaust {
		t.Fatalf("got %v", err)
	}
}
