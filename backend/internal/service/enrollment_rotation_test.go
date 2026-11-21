package service

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestPreviousKeyFinishesChallengeDuringRotation(t *testing.T) {
	fx := newV2(t)
	grant, _ := fx.register(t)
	challenge, err := fx.svc.EnrollChallenge(context.Background(), grant, true)
	if err != nil {
		t.Fatal(err)
	}
	current, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	config := fx.svc.cfg
	config.Rotation = &EnrollmentRotation{Origin: "https://example.test", Epoch: 2,
		Signer: signer, PreviousKey: config.ServerKey, PreviousKeyID: config.KeyID}
	config.ServerKey, config.KeyID = current, "k2"
	rotated, err := NewAuthV2Service(fx.repo, fx.ident, config)
	if err != nil {
		t.Fatal(err)
	}
	rotated.now = fx.svc.now
	fx.svc = rotated
	if rotated.ServerKey(false).Rotation != nil || rotated.ServerKey(true).Rotation == nil {
		t.Fatal("rotation metadata must be opt-in")
	}
	session, err := fx.finish(t, newPhone(t), challenge.ChallengeID, challenge.Nonce, nil)
	if err != nil {
		t.Fatalf("previous responder could not finish its challenge: %v", err)
	}
	if session.RotationSigner != rotated.ServerKey(true).Rotation.Signer {
		t.Fatal("encrypted grant did not authenticate the signer")
	}
}

func TestEnrollmentRotationBindsOriginKeyAndEpoch(t *testing.T) {
	signer, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	rotation := EnrollmentRotation{Origin: "https://example.test", Epoch: 2, Signer: signer}
	key := make([]byte, 32)
	_, encoded, err := rotation.metadata("key2", key)
	if err != nil {
		t.Fatal(err)
	}
	signature, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	verify := func(config EnrollmentRotation, keyID string, publicKey []byte) bool {
		digest := sha256.Sum256(config.statement(keyID, publicKey))
		return ecdsa.VerifyASN1(&signer.PublicKey, digest[:], signature)
	}
	if !verify(rotation, "key2", key) {
		t.Fatal("signed key failed verification")
	}
	oldEpoch := rotation
	oldEpoch.Epoch--
	otherOrigin := rotation
	otherOrigin.Origin = "https://other.test"
	if verify(oldEpoch, "key2", key) || verify(otherOrigin, "key2", key) || verify(rotation, "key3", key) {
		t.Fatal("signature accepted modified metadata")
	}
	key[0] = 1
	if verify(rotation, "key2", key) {
		t.Fatal("signature accepted modified public key")
	}
}
