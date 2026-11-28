package service

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"ipv6ftp/internal/models"
	"ipv6ftp/internal/noiseik"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/security"
	"ipv6ftp/internal/transport/http/contracts"
)

// ---- fakes ----

type enrollAcct struct {
	username, hash   string
	version          int
	generation       int64
	activated, acked bool
	pending          bool
	devices          map[string]*enrollDevice // by hex key
	sessions         map[string]*enrollSession
	refreshHashes    map[string]string // hash -> session id
}

type enrollDevice struct {
	id      string
	revoked bool
}

type enrollSession struct {
	device  string
	revoked bool
}

type chal struct {
	pid               string
	nonce             []byte
	expires           time.Time
	consumed          bool
	binding           EnrollmentBinding
	keyID             string
	rotationSupported bool
}

type fakeEnrollRepo struct {
	accts      map[string]*enrollAcct
	byName     map[string]string
	challenges map[string]*chal
	keyOwner   map[string]string
	commitErr  error
}

func newFakeEnroll() *fakeEnrollRepo {
	return &fakeEnrollRepo{accts: map[string]*enrollAcct{}, byName: map[string]string{}, challenges: map[string]*chal{}, keyOwner: map[string]string{}}
}

func (f *fakeEnrollRepo) CreatePendingAccount(_ context.Context, username, hash string) (string, error) {
	if _, ok := f.byName[username]; ok {
		return "", ErrUsernameTaken
	}
	pid := newUUID()
	f.accts[pid] = &enrollAcct{username: username, hash: hash, version: 1, generation: 1, devices: map[string]*enrollDevice{}, sessions: map[string]*enrollSession{}, refreshHashes: map[string]string{}}
	f.byName[username] = pid
	return pid, nil
}
func (f *fakeEnrollRepo) FindEnrollmentLogin(_ context.Context, username string) (string, string, EnrollmentBinding, error) {
	pid, ok := f.byName[strings.ToLower(username)]
	if !ok {
		return "", "", EnrollmentBinding{}, ErrAccountNotFound
	}
	a := f.accts[pid]
	return pid, a.hash, EnrollmentBinding{CredentialVersion: a.version, Generation: a.generation}, nil
}
func (f *fakeEnrollRepo) GetCredential(_ context.Context, pid string) (AccountCredential, error) {
	a, ok := f.accts[pid]
	if !ok {
		return AccountCredential{}, ErrAccountNotFound
	}
	return AccountCredential{PasswordHash: a.hash, Version: a.version, RecoveryAcked: a.acked}, nil
}
func (f *fakeEnrollRepo) StoreChallenge(_ context.Context, id string, challenge EnrollmentChallenge, exp time.Time) error {
	pid := challenge.PrincipalID
	a := f.accts[pid]
	if a == nil {
		return ErrAccountNotFound
	}
	if a.pending {
		return ErrPendingDeletion
	}
	if a.version != challenge.Binding.CredentialVersion || a.generation != challenge.Binding.Generation {
		return ErrEnrollRaced
	}
	for _, c := range f.challenges {
		if c.pid == pid {
			c.consumed = true
		}
	}
	f.challenges[id] = &chal{pid: pid, nonce: challenge.Nonce, expires: exp, binding: challenge.Binding, keyID: challenge.ServerKeyID, rotationSupported: challenge.RotationSupported}
	return nil
}
func (f *fakeEnrollRepo) ConsumeChallenge(_ context.Context, id string, now time.Time) (EnrollmentChallenge, error) {
	c, ok := f.challenges[id]
	if !ok || c.consumed || !now.Before(c.expires) {
		return EnrollmentChallenge{}, ErrChallengeUnusable
	}
	c.consumed = true
	return EnrollmentChallenge{PrincipalID: c.pid, Nonce: c.nonce, Binding: c.binding, ServerKeyID: c.keyID, RotationSupported: c.rotationSupported}, nil
}
func (f *fakeEnrollRepo) PlanEnrollment(_ context.Context, pid string, key []byte) (EnrollPlan, error) {
	a, ok := f.accts[pid]
	if !ok {
		return EnrollPlan{}, ErrAccountNotFound
	}
	p := EnrollPlan{Username: a.username, Generation: a.generation, PendingDeletion: a.pending, Activated: a.activated}
	if d, ok := a.devices[string(key)]; ok && !d.revoked {
		p.ExistingDeviceID = d.id
	}
	return p, nil
}
func (f *fakeEnrollRepo) CommitEnrollment(_ context.Context, c EnrollCommit) error {
	if f.commitErr != nil {
		return f.commitErr
	}
	a := f.accts[c.PrincipalID]
	if a.pending {
		return ErrPendingDeletion
	}
	if a.generation != c.ExpectedGeneration || a.version != c.ExpectedCredentialVersion {
		return ErrEnrollRaced
	}
	if owner, ok := f.keyOwner[string(c.PublicKey)]; ok && owner != c.PrincipalID {
		return ErrDeviceKeyTaken
	}
	if d, ok := a.devices[string(c.PublicKey)]; ok && d.revoked {
		return ErrDeviceKeyTaken
	}
	for _, s := range a.sessions {
		s.revoked = true
	}
	for k, d := range a.devices {
		if k != string(c.PublicKey) {
			d.revoked = true
		}
	}
	if _, ok := a.devices[string(c.PublicKey)]; !ok {
		a.devices[string(c.PublicKey)] = &enrollDevice{id: c.DeviceID}
	}
	f.keyOwner[string(c.PublicKey)] = c.PrincipalID
	a.sessions[c.SessionID] = &enrollSession{device: c.DeviceID}
	a.refreshHashes[c.RefreshHash] = c.SessionID
	a.generation++
	return nil
}
func (f *fakeEnrollRepo) Activate(_ context.Context, pid, sid, did string, generation int, operationKey string) error {
	a := f.accts[pid]
	session, ok := a.sessions[sid]
	if !ok || session.revoked || session.device != did || a.generation != int64(generation) || a.pending {
		return ErrSessionNotActive
	}
	if !a.acked {
		return ErrNotAcknowledged
	}
	a.activated = true
	return nil
}
func (f *fakeEnrollRepo) Snapshot(_ context.Context, pid, sid, did string) (SnapshotData, error) {
	a, ok := f.accts[pid]
	if !ok {
		return SnapshotData{}, ErrAccountNotFound
	}
	s, ok := a.sessions[sid]
	if !ok || s.revoked || s.device != did {
		return SnapshotData{}, ErrSessionNotActive
	}
	return SnapshotData{Username: a.username, Revision: 7, Generation: a.generation, PendingDeletion: a.pending, Activated: a.activated}, nil
}

// fakeIdentity overrides only what refresh and logout use; any other call panics on the nil embed.
type fakeIdentity struct {
	repository.IdentityRepo
	repo      *fakeEnrollRepo
	consumed  map[string]bool
	committed bool
}

func (f *fakeIdentity) RotateRefreshToken(_ context.Context, oldHash, newHash, _, _, _ string, _ time.Time) (models.User, string, error) {
	for pid, a := range f.repo.accts {
		sid, ok := a.refreshHashes[oldHash]
		if !ok {
			continue
		}
		if f.consumed[oldHash] {
			a.sessions[sid].revoked = true
			return models.User{}, "", repository.ErrRefreshTokenReuse
		}
		if a.sessions[sid].revoked {
			return models.User{}, "", pgx.ErrNoRows
		}
		if f.committed {
			return models.User{}, "", repository.ErrRefreshRotationCommitted
		}
		f.consumed[oldHash] = true
		a.refreshHashes[newHash] = sid
		return models.User{ID: pid, Username: a.username, Role: "app_user", AccountType: "registered", AuthVersion: 1, DeviceID: a.sessions[sid].device}, sid, nil
	}
	return models.User{}, "", pgx.ErrNoRows
}
func (f *fakeIdentity) RevokeSession(_ context.Context, pid, sid string) error {
	a := f.repo.accts[pid]
	if a == nil || a.sessions[sid] == nil {
		return pgx.ErrNoRows
	}
	a.sessions[sid].revoked = true
	return nil
}

// ---- fixture ----

const goodPassword = "correct horse battery staple"

type v2fx struct {
	svc    *AuthV2Service
	repo   *fakeEnrollRepo
	ident  *fakeIdentity
	server *ecdh.PrivateKey
	clock  *time.Time
}

func newV2(t *testing.T) *v2fx {
	t.Helper()
	server, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	repo := newFakeEnroll()
	ident := &fakeIdentity{repo: repo, consumed: map[string]bool{}}
	svc, err := NewAuthV2Service(repo, ident, AuthV2Config{Pepper: []byte("0123456789abcdef0123"), JWTSecret: []byte("jwt-secret-for-tests-jwt-secret"), ServerKey: server, KeyID: "k1"})
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }
	return &v2fx{svc: svc, repo: repo, ident: ident, server: server, clock: &clock}
}

// phone plays the Android client: it pins the server key and runs the IK initiator.
type phone struct {
	key *ecdh.PrivateKey
}

func newPhone(t *testing.T) *phone {
	t.Helper()
	k, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return &phone{key: k}
}

// enroll runs challenge + finish and returns the decrypted session grant.
func (fx *v2fx) enroll(t *testing.T, p *phone, setupGrant string) (contracts.SessionGrant, error) {
	t.Helper()
	ch, err := fx.svc.EnrollChallenge(context.Background(), setupGrant, false)
	if err != nil {
		return contracts.SessionGrant{}, err
	}
	return fx.finish(t, p, ch.ChallengeID, ch.Nonce, nil)
}

func (fx *v2fx) finish(t *testing.T, p *phone, id, nonceB64 string, tamper func([]byte) []byte) (contracts.SessionGrant, error) {
	t.Helper()
	nonce, _ := base64.RawURLEncoding.DecodeString(nonceB64)
	pro, err := enrollPrologue(id, nonce)
	if err != nil {
		t.Fatal(err)
	}
	init, err := noiseik.NewInitiator(p.key, fx.server.PublicKey().Bytes(), pro)
	if err != nil {
		t.Fatal(err)
	}
	m1, err := init.WriteMessage1(nil)
	if err != nil {
		t.Fatal(err)
	}
	if tamper != nil {
		m1 = tamper(m1)
	}
	out, err := fx.svc.EnrollFinish(context.Background(), id, base64.RawURLEncoding.EncodeToString(m1))
	if err != nil {
		return contracts.SessionGrant{}, err
	}
	m2, _ := base64.RawURLEncoding.DecodeString(out.Handshake)
	payload, _, err := init.ReadMessage2(m2)
	if err != nil {
		t.Fatalf("phone could not open message 2: %v", err)
	}
	var g contracts.SessionGrant
	if err := contracts.DecodeBytes(payload, &g); err != nil {
		t.Fatalf("grant is not a valid contract: %v", err)
	}
	return g, nil
}

func (fx *v2fx) register(t *testing.T) (string, string) {
	t.Helper()
	g, err := fx.svc.BeginRegistered(context.Background(), "alice_01", goodPassword)
	if err != nil {
		t.Fatal(err)
	}
	return g.SetupGrant, fx.repo.byName["alice_01"]
}

// ---- tests ----

func TestRegisteredBeginCreatesNoSessionAndRejectsWeakInput(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	if len(fx.repo.accts[pid].sessions) != 0 || len(fx.repo.accts[pid].devices) != 0 {
		t.Fatal("begin created a session or device")
	}
	if err := contracts.DecodeBytes([]byte(`{"setup_grant":"`+grant+`","expires_in_seconds":900}`), &contracts.SetupGrantResponse{}); err != nil {
		t.Fatalf("response contract: %v", err)
	}
	if _, err := fx.svc.BeginRegistered(context.Background(), "alice_01", goodPassword); errCode(err) != contracts.CodeConflict {
		t.Fatalf("duplicate must conflict, not succeed: %v", err)
	}
	if _, err := fx.svc.BeginRegistered(context.Background(), "x", goodPassword); errCode(err) != contracts.CodeValidationFailed {
		t.Fatalf("short username: %v", err)
	}
	if _, err := fx.svc.BeginRegistered(context.Background(), "bob_02", "short"); errCode(err) != contracts.CodeValidationFailed {
		t.Fatalf("weak password: %v", err)
	}
}

func TestFullEnrollmentDeliversTheSessionOnlyThroughNoise(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	p := newPhone(t)
	g, err := fx.enroll(t, p, grant)
	if err != nil {
		t.Fatal(err)
	}
	if g.AccountState != "recovery_setup" || g.Generation != 2 {
		t.Fatalf("grant %+v", g)
	}
	claims, err := security.ParseToken([]byte("jwt-secret-for-tests-jwt-secret"), g.AccessToken, "access")
	if err != nil || claims.Sub != pid || claims.SessionID != g.SessionID || claims.DeviceID != g.DeviceID {
		t.Fatalf("access token does not match the grant: %v %+v", err, claims)
	}
	a := fx.repo.accts[pid]
	if a.generation != 2 || a.devices[string(p.key.PublicKey().Bytes())].revoked || a.sessions[g.SessionID].revoked {
		t.Fatalf("state after enroll: %+v", a)
	}
	if _, ok := a.refreshHashes[hashOpaqueToken(g.RefreshToken)]; !ok {
		t.Fatal("refresh token hash was not stored")
	}
}

func TestAnEavesdropperWithoutTheDeviceKeyCannotEnrollOrReadTheSession(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	ch, err := fx.svc.EnrollChallenge(context.Background(), grant, false)
	if err != nil {
		t.Fatal(err)
	}
	// An attacker replays a flipped copy of a handshake: nothing may be committed.
	victim := newPhone(t)
	_, err = fx.finish(t, victim, ch.ChallengeID, ch.Nonce, func(m []byte) []byte { m[len(m)-1] ^= 1; return m })
	if errCode(err) != contracts.CodeForbidden {
		t.Fatalf("tampered handshake: %v", err)
	}
	if len(fx.repo.accts[pid].sessions) != 0 || fx.repo.accts[pid].generation != 1 {
		t.Fatal("a failed handshake changed account state")
	}
	// The challenge is single use even after a failure.
	if _, err := fx.finish(t, victim, ch.ChallengeID, ch.Nonce, nil); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("challenge reuse: %v", err)
	}
}

func TestHandshakeBoundToItsOwnChallengeCannotBeMovedToAnother(t *testing.T) {
	fx := newV2(t)
	grant, _ := fx.register(t)
	ch1, _ := fx.svc.EnrollChallenge(context.Background(), grant, false)
	ch2, _ := fx.svc.EnrollChallenge(context.Background(), grant, false) // supersedes ch1
	p := newPhone(t)
	// Handshake built for ch1's nonce but submitted against ch2's id: the prologue differs.
	nonce1, _ := base64.RawURLEncoding.DecodeString(ch1.Nonce)
	pro, _ := enrollPrologue(ch1.ChallengeID, nonce1)
	init, _ := noiseik.NewInitiator(p.key, fx.server.PublicKey().Bytes(), pro)
	m1, _ := init.WriteMessage1(nil)
	if _, err := fx.svc.EnrollFinish(context.Background(), ch2.ChallengeID, base64.RawURLEncoding.EncodeToString(m1)); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("cross-challenge replay: %v", err)
	}
	if _, err := fx.svc.EnrollFinish(context.Background(), ch1.ChallengeID, base64.RawURLEncoding.EncodeToString(m1)); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("superseded challenge: %v", err)
	}
}

func TestExpiredChallengeIsRejected(t *testing.T) {
	fx := newV2(t)
	grant, _ := fx.register(t)
	ch, _ := fx.svc.EnrollChallenge(context.Background(), grant, false)
	*fx.clock = fx.clock.Add(challengeLifetime + time.Second)
	if _, err := fx.finish(t, newPhone(t), ch.ChallengeID, ch.Nonce, nil); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("expired: %v", err)
	}
}

func TestSetupGrantRules(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	ctx := context.Background()
	if _, err := fx.svc.EnrollChallenge(ctx, grant+"x", false); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("tampered grant: %v", err)
	}
	if _, err := fx.svc.EnrollChallenge(ctx, "garbage", false); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("garbage grant: %v", err)
	}
	// A grant minted by another deployment (different pepper) is not accepted.
	other := newV2(t)
	otherGrant, _ := other.svc.issueGrant(func() string { _, p := other.register(t); return p }(), EnrollmentBinding{CredentialVersion: 1, Generation: 1})
	if _, err := fx.svc.EnrollChallenge(ctx, otherGrant.SetupGrant, false); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("foreign grant: %v", err)
	}
	// Password change or recovery bumps the credential version and kills outstanding grants.
	fx.repo.accts[pid].version++
	if _, err := fx.svc.EnrollChallenge(ctx, grant, false); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("grant survived a credential change: %v", err)
	}
	fx.repo.accts[pid].version--
	*fx.clock = fx.clock.Add(setupGrantLifetime + time.Second)
	if _, err := fx.svc.EnrollChallenge(ctx, grant, false); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("expired grant: %v", err)
	}
}

func TestEnrollmentRejectsCredentialChangeAfterChallenge(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	ctx := context.Background()
	challenge, err := fx.svc.EnrollChallenge(ctx, grant, false)
	if err != nil {
		t.Fatal(err)
	}
	phone := newPhone(t)
	nonce, err := base64.RawURLEncoding.DecodeString(challenge.Nonce)
	if err != nil {
		t.Fatal(err)
	}
	prologue, err := enrollPrologue(challenge.ChallengeID, nonce)
	if err != nil {
		t.Fatal(err)
	}
	initiator, err := noiseik.NewInitiator(phone.key, fx.server.PublicKey().Bytes(), prologue)
	if err != nil {
		t.Fatal(err)
	}
	message, err := initiator.WriteMessage1(nil)
	if err != nil {
		t.Fatal(err)
	}
	fx.repo.accts[pid].version++
	_, err = fx.svc.EnrollFinish(ctx, challenge.ChallengeID, base64.RawURLEncoding.EncodeToString(message))
	if errCode(err) != contracts.CodeConflict || len(fx.repo.accts[pid].sessions) != 0 {
		t.Fatalf("stale challenge changed account ownership: %v", err)
	}
}

func TestSetupResumeNeverCreatesAnAccountAndFailuresAreIdentical(t *testing.T) {
	fx := newV2(t)
	_, pid := fx.register(t)
	ctx := context.Background()
	before := len(fx.repo.accts)
	g, err := fx.svc.ResumeSetup(ctx, "Alice_01", goodPassword)
	if err != nil || g.SetupGrant == "" {
		t.Fatalf("resume: %v", err)
	}
	if len(fx.repo.accts) != before {
		t.Fatal("resume created an account")
	}
	if _, err := fx.svc.EnrollChallenge(ctx, g.SetupGrant, false); err != nil {
		t.Fatalf("resumed grant unusable: %v", err)
	}
	_, e1 := fx.svc.ResumeSetup(ctx, "alice_01", "wrong password here!")
	_, e2 := fx.svc.ResumeSetup(ctx, "nobody_here", goodPassword)
	if errCode(e1) != contracts.CodeForbidden || errCode(e2) != contracts.CodeForbidden || e1.Error() != e2.Error() {
		t.Fatalf("failures differ or are not forbidden: %v / %v", e1, e2)
	}
	_ = pid
}

func TestNewPhoneReplacesTheOldOneAndRevokesItsAuthorization(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	oldPhone, newP := newPhone(t), newPhone(t)
	g1, err := fx.enroll(t, oldPhone, grant)
	if err != nil {
		t.Fatal(err)
	}
	resume, _ := fx.svc.ResumeSetup(context.Background(), "alice_01", goodPassword)
	g2, err := fx.enroll(t, newP, resume.SetupGrant)
	if err != nil {
		t.Fatal(err)
	}
	a := fx.repo.accts[pid]
	if !a.sessions[g1.SessionID].revoked || a.sessions[g2.SessionID].revoked {
		t.Fatal("old session must be revoked and the new one live")
	}
	if !a.devices[string(oldPhone.key.PublicKey().Bytes())].revoked {
		t.Fatal("old device not revoked")
	}
	if g2.Generation != 3 {
		t.Fatalf("generation %d", g2.Generation)
	}
	if _, err := fx.svc.Bootstrap(context.Background(), pid, g1.SessionID, g1.DeviceID); errCode(err) != contracts.CodeSessionInvalid {
		t.Fatalf("old session still bootstraps: %v", err)
	}
	// A revoked phone cannot come back with its old key.
	back, _ := fx.svc.ResumeSetup(context.Background(), "alice_01", goodPassword)
	if _, err := fx.enroll(t, oldPhone, back.SetupGrant); errCode(err) != contracts.CodeConflict {
		t.Fatalf("revoked key re-enrolled: %v", err)
	}
}

func TestSamePhoneRestoreKeepsItsDeviceID(t *testing.T) {
	fx := newV2(t)
	grant, _ := fx.register(t)
	p := newPhone(t)
	g1, err := fx.enroll(t, p, grant)
	if err != nil {
		t.Fatal(err)
	}
	resume, _ := fx.svc.ResumeSetup(context.Background(), "alice_01", goodPassword)
	g2, err := fx.enroll(t, p, resume.SetupGrant)
	if err != nil {
		t.Fatal(err)
	}
	if g1.DeviceID != g2.DeviceID || g2.Generation != 3 || g1.SessionID == g2.SessionID {
		t.Fatalf("restore allocated a new device or reused a session: %+v %+v", g1, g2)
	}
}

func TestDeviceKeyOfAnotherAccountIsRejected(t *testing.T) {
	fx := newV2(t)
	grantA, _ := fx.register(t)
	p := newPhone(t)
	if _, err := fx.enroll(t, p, grantA); err != nil {
		t.Fatal(err)
	}
	gB, err := fx.svc.BeginRegistered(context.Background(), "bob_02", goodPassword)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fx.enroll(t, p, gB.SetupGrant); errCode(err) != contracts.CodeConflict {
		t.Fatalf("one key enrolled to two accounts: %v", err)
	}
}

func TestPendingDeletionAndRacedEnrollmentFailClosed(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	fx.repo.accts[pid].pending = true
	if _, err := fx.enroll(t, newPhone(t), grant); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("pending deletion: %v", err)
	}
	fx.repo.accts[pid].pending = false
	fx.repo.commitErr = ErrEnrollRaced
	if _, err := fx.enroll(t, newPhone(t), grant); errCode(err) != contracts.CodeConflict {
		t.Fatalf("race: %v", err)
	}
}

func TestActivationNeedsAcknowledgedCodesAndBootstrapReflectsState(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	g, _ := fx.enroll(t, newPhone(t), grant)
	ctx := context.Background()
	snap, err := fx.svc.Bootstrap(ctx, pid, g.SessionID, g.DeviceID)
	if err != nil || snap.AccountState != "recovery_setup" || len(snap.Capabilities) != 0 {
		t.Fatalf("%+v %v", snap, err)
	}
	if err := contracts.DecodeBytes(mustJSON(snap), &contracts.BootstrapSnapshot{}); err != nil {
		t.Fatalf("snapshot violates its own contract: %v", err)
	}
	if err := fx.svc.Activate(ctx, pid, g.SessionID, g.DeviceID, int(g.Generation), ""); errCode(err) != contracts.CodeConflict {
		t.Fatalf("activation without acknowledgement: %v", err)
	}
	fx.repo.accts[pid].acked = true
	if err := fx.svc.Activate(ctx, pid, g.SessionID, g.DeviceID, int(g.Generation)+1, ""); errCode(err) != contracts.CodeSessionInvalid {
		t.Fatalf("stale generation activated account: %v", err)
	}
	if fx.repo.accts[pid].activated {
		t.Fatal("stale activation changed account")
	}
	if err := fx.svc.Activate(ctx, pid, g.SessionID, g.DeviceID, int(g.Generation), ""); err != nil {
		t.Fatal(err)
	}
	snap, _ = fx.svc.Bootstrap(ctx, pid, g.SessionID, g.DeviceID)
	if snap.AccountState != "active" || len(snap.Capabilities) == 0 {
		t.Fatalf("%+v", snap)
	}
	if _, err := fx.svc.Bootstrap(ctx, pid, g.SessionID, newUUID()); errCode(err) != contracts.CodeSessionInvalid {
		t.Fatalf("foreign device id: %v", err)
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func TestRefreshRotatesAndReuseKillsTheSession(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	g, _ := fx.enroll(t, newPhone(t), grant)
	ctx := context.Background()
	r1, err := fx.svc.Refresh(ctx, g.RefreshToken)
	if err != nil || r1.RefreshToken == g.RefreshToken {
		t.Fatalf("rotation: %v", err)
	}
	if err := contracts.DecodeBytes(mustJSON(r1), &contracts.RefreshResponse{}); err != nil {
		t.Fatalf("response contract: %v", err)
	}
	if _, err := fx.svc.Refresh(ctx, g.RefreshToken); errCode(err) != contracts.CodeSessionInvalid {
		t.Fatalf("reuse: %v", err)
	}
	if !fx.repo.accts[pid].sessions[g.SessionID].revoked {
		t.Fatal("reuse did not revoke the session lineage")
	}
	if _, err := fx.svc.Refresh(ctx, r1.RefreshToken); errCode(err) != contracts.CodeSessionInvalid {
		t.Fatalf("descendant of a reused token must die with the session: %v", err)
	}
	if _, err := fx.svc.Refresh(ctx, "completely-unknown-token-value"); errCode(err) != contracts.CodeSessionInvalid {
		t.Fatalf("unknown token: %v", err)
	}
}

func TestUncertainRefreshIsUnavailableNotSessionInvalid(t *testing.T) {
	fx := newV2(t)
	grant, _ := fx.register(t)
	g, _ := fx.enroll(t, newPhone(t), grant)
	fx.ident.committed = true
	if _, err := fx.svc.Refresh(context.Background(), g.RefreshToken); errCode(err) != contracts.CodeUnavailable {
		t.Fatalf("an uncertain commit must not look like compromise: %v", err)
	}
}

func TestLogoutIsIdempotent(t *testing.T) {
	fx := newV2(t)
	grant, pid := fx.register(t)
	g, _ := fx.enroll(t, newPhone(t), grant)
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if err := fx.svc.Logout(ctx, pid, g.SessionID); err != nil {
			t.Fatalf("logout #%d: %v", i, err)
		}
	}
	if !fx.repo.accts[pid].sessions[g.SessionID].revoked {
		t.Fatal("session survived logout")
	}
	if err := fx.svc.Logout(ctx, pid, newUUID()); err != nil {
		t.Fatalf("unknown session: %v", err)
	}
	if err := fx.svc.Logout(ctx, pid, ""); err != nil {
		t.Fatalf("no session id: %v", err)
	}
}

func TestServerKeyResponseMatchesContractAndNeverLeaksThePrivateKey(t *testing.T) {
	fx := newV2(t)
	k := fx.svc.ServerKey(false)
	if err := contracts.DecodeBytes(mustJSON(k), &contracts.ServerKeyResponse{}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(k.PublicKey, base64.RawURLEncoding.EncodeToString(fx.server.Bytes())) {
		t.Fatal("private key exposed")
	}
	pub, _ := base64.RawURLEncoding.DecodeString(k.PublicKey)
	if string(pub) != string(fx.server.PublicKey().Bytes()) {
		t.Fatal("wrong key published")
	}
}

func TestNewAuthV2ServiceRejectsWeakConfig(t *testing.T) {
	good, _ := ecdh.X25519().GenerateKey(rand.Reader)
	p256, _ := ecdh.P256().GenerateKey(rand.Reader)
	repo := newFakeEnroll()
	id := &fakeIdentity{repo: repo}
	for name, cfg := range map[string]AuthV2Config{
		"short pepper": {Pepper: []byte("short"), JWTSecret: []byte("s"), ServerKey: good, KeyID: "k"},
		"no secret":    {Pepper: []byte("0123456789abcdef0123"), ServerKey: good, KeyID: "k"},
		"no key":       {Pepper: []byte("0123456789abcdef0123"), JWTSecret: []byte("s"), KeyID: "k"},
		"wrong curve":  {Pepper: []byte("0123456789abcdef0123"), JWTSecret: []byte("s"), ServerKey: p256, KeyID: "k"},
		"no key id":    {Pepper: []byte("0123456789abcdef0123"), JWTSecret: []byte("s"), ServerKey: good},
	} {
		if _, err := NewAuthV2Service(repo, id, cfg); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if _, err := NewAuthV2Service(nil, id, AuthV2Config{}); err == nil {
		t.Error("nil repo accepted")
	}
}
