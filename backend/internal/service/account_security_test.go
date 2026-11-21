package service

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"ipv6ftp/internal/accountpolicy"
	appErrors "ipv6ftp/internal/errors"
)

type fakeAcct struct {
	username, hash, email string
	version               int
	acked                 bool
	sessionsRevoked       int
	devicesRevoked        int
}

type fakeGrant struct {
	pid     string
	version int
	expires time.Time
	used    bool
}

type fakeSecRepo struct {
	accts         map[string]*fakeAcct
	sets          map[string][]string
	consumed      map[string]bool
	grants        map[string]*fakeGrant
	challenges    map[string]*Challenge
	chConsumed    map[string]bool
	issues        map[string][]time.Time
	outbox        []OutboxItem
	nextID        int
	now           func() time.Time
	beforeApply   func()
	beforeReplace func()
}

func newFakeRepo(now func() time.Time) *fakeSecRepo {
	return &fakeSecRepo{accts: map[string]*fakeAcct{}, sets: map[string][]string{}, consumed: map[string]bool{},
		grants: map[string]*fakeGrant{}, challenges: map[string]*Challenge{}, chConsumed: map[string]bool{}, issues: map[string][]time.Time{}, now: now}
}

func (f *fakeSecRepo) GetCredential(_ context.Context, pid string) (AccountCredential, error) {
	a, ok := f.accts[pid]
	if !ok {
		return AccountCredential{}, ErrAccountNotFound
	}
	return AccountCredential{PasswordHash: a.hash, Version: a.version, RecoveryAcked: a.acked}, nil
}
func (f *fakeSecRepo) FindPrincipalByUsername(_ context.Context, u string) (string, error) {
	for id, a := range f.accts {
		if strings.EqualFold(a.username, u) {
			return id, nil
		}
	}
	return "", ErrAccountNotFound
}
func (f *fakeSecRepo) FindPrincipalByVerifiedEmail(_ context.Context, e string) (string, error) {
	for id, a := range f.accts {
		if a.email == e {
			return id, nil
		}
	}
	return "", ErrAccountNotFound
}
func (f *fakeSecRepo) ReplaceRecoverySet(_ context.Context, pid string, expectedVersion int, v []string) error {
	if f.beforeReplace != nil {
		f.beforeReplace()
	}
	if f.accts[pid].version != expectedVersion {
		return ErrStaleCredential
	}
	f.sets[pid] = v
	for _, x := range v {
		delete(f.consumed, pid+x)
	}
	f.accts[pid].acked = false
	return nil
}
func (f *fakeSecRepo) AckRecoverySet(_ context.Context, pid, verifier string) error {
	for _, stored := range f.sets[pid] {
		if stored == verifier && !f.consumed[pid+stored] {
			f.accts[pid].acked = true
			return nil
		}
	}
	return ErrAccountNotFound
}
func (f *fakeSecRepo) ActiveRecoveryVerifiers(_ context.Context, pid string) ([]string, error) {
	var out []string
	for _, v := range f.sets[pid] {
		if !f.consumed[pid+v] {
			out = append(out, v)
		}
	}
	return out, nil
}
func (f *fakeSecRepo) ConsumeRecoveryVerifier(_ context.Context, pid, v string) (bool, error) {
	if f.consumed[pid+v] {
		return false, nil
	}
	f.consumed[pid+v] = true
	return true, nil
}
func (f *fakeSecRepo) CreateRecoveryGrant(_ context.Context, pid string, ver int, _, hash string, exp time.Time) error {
	f.grants[hash] = &fakeGrant{pid: pid, version: ver, expires: exp}
	return nil
}
func (f *fakeSecRepo) ConsumeRecoveryGrant(_ context.Context, hash string, now time.Time) (string, int, error) {
	g, ok := f.grants[hash]
	if !ok || g.used || now.After(g.expires) {
		return "", 0, ErrGrantUnusable
	}
	g.used = true
	return g.pid, g.version, nil
}
func (f *fakeSecRepo) ApplyCredentialChange(_ context.Context, pid string, expected int, hash string, revokeDevices bool) error {
	if f.beforeApply != nil {
		f.beforeApply()
	}
	a := f.accts[pid]
	if a.version != expected {
		return ErrStaleCredential
	}
	a.hash, a.version = hash, a.version+1
	a.sessionsRevoked++
	if revokeDevices {
		a.devicesRevoked++
	}
	for _, g := range f.grants {
		if g.pid == pid {
			g.used = true
		}
	}
	return nil
}
func (f *fakeSecRepo) SupersedeAndStoreChallenge(_ context.Context, c Challenge, item OutboxItem) (string, error) {
	f.nextID++
	id := "00000000-0000-4000-8000-00000000000" + string(rune('0'+f.nextID))
	c.ID = id
	f.challenges[id] = &c
	f.issues[c.Purpose+"|"+c.PrincipalID] = append(f.issues[c.Purpose+"|"+c.PrincipalID], f.now())
	item.ChallengeID = id
	f.outbox = append(f.outbox, item)
	return id, nil
}
func (f *fakeSecRepo) RecentChallengeIssues(_ context.Context, purpose, pid string, _ time.Time) ([]time.Time, error) {
	return f.issues[purpose+"|"+pid], nil
}
func (f *fakeSecRepo) GetChallenge(_ context.Context, id string) (Challenge, error) {
	c, ok := f.challenges[id]
	if !ok || f.chConsumed[id] {
		return Challenge{}, ErrAccountNotFound
	}
	return *c, nil
}
func (f *fakeSecRepo) SaveChallengeState(_ context.Context, id string, st accountpolicy.EmailChallenge, consumed bool) error {
	f.challenges[id].State = st
	f.chConsumed[id] = consumed
	return nil
}
func (f *fakeSecRepo) AssignVerifiedEmail(_ context.Context, pid, email string) error {
	for id, a := range f.accts {
		if a.email == email && id != pid {
			return ErrEmailTaken
		}
	}
	f.accts[pid].email = email
	return nil
}

var (
	testPepper = []byte("0123456789abcdef0123456789abcdef")
	testKey    = []byte("0123456789abcdef0123456789abcdef")
	goodPW     = "correct horse battery staple"
	newPW      = "another long passphrase here"
)

type env struct {
	svc  *AccountSecurityService
	repo *fakeSecRepo
	t    time.Time
}

func newEnv(t *testing.T) *env {
	e := &env{t: time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)}
	now := func() time.Time { return e.t }
	e.repo = newFakeRepo(now)
	hash, err := hashPasswordCredential(goodPW)
	if err != nil {
		t.Fatal(err)
	}
	e.repo.accts["p1"] = &fakeAcct{username: "alice", hash: hash, version: 1}
	e.repo.accts["p2"] = &fakeAcct{username: "bob", hash: hash, version: 1}
	svc, err := NewAccountSecurityService(e.repo, AccountSecurityConfig{RecoveryPepper: testPepper, PayloadKey: testKey, PayloadKeyVer: 1})
	if err != nil {
		t.Fatal(err)
	}
	svc.now = now
	e.svc = svc
	return e
}

func codeOf(t *testing.T, item OutboxItem) string {
	t.Helper()
	m, err := OpenPayload(testKey, item.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	return m["code"]
}

func errCode(err error) string {
	var ae *appErrors.AppError
	if errors.As(err, &ae) {
		return ae.Code
	}
	return ""
}

func TestConfigValidation(t *testing.T) {
	if _, err := NewAccountSecurityService(nil, AccountSecurityConfig{RecoveryPepper: []byte("short"), PayloadKey: testKey}); err == nil {
		t.Fatal("short pepper accepted")
	}
	if _, err := NewAccountSecurityService(nil, AccountSecurityConfig{RecoveryPepper: testPepper, PayloadKey: []byte("short")}); err == nil {
		t.Fatal("short key accepted")
	}
}

func TestRecoveryCodeRegenerationRetiresOldSet(t *testing.T) {
	e := newEnv(t)
	first, err := e.svc.issueRecoveryCodes(context.Background(), "p1", e.repo.accts["p1"].version)
	if err != nil || len(first) != 10 {
		t.Fatalf("%d %v", len(first), err)
	}
	if e.repo.accts["p1"].acked {
		t.Fatal("new set must start unacknowledged")
	}
	if err := e.svc.AcknowledgeRecoveryCodes(context.Background(), "p1", first[0]); err != nil || !e.repo.accts["p1"].acked {
		t.Fatal("ack failed")
	}
	if _, err := e.svc.issueRecoveryCodes(context.Background(), "p1", e.repo.accts["p1"].version); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.AcknowledgeRecoveryCodes(context.Background(), "p1", first[0]); err == nil || e.repo.accts["p1"].acked {
		t.Fatal("retired code acknowledged the replacement set")
	}
	verifiers, _ := e.repo.ActiveRecoveryVerifiers(context.Background(), "p1")
	if accountpolicy.VerifyRecoveryCode(testPepper, first[0], verifiers) != -1 {
		t.Fatal("old code still valid after regeneration")
	}
}

func TestRecoveryCodeRegenerationRejectsStaleCredentialVersion(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	old, err := e.svc.issueRecoveryCodes(ctx, "p1", e.repo.accts["p1"].version)
	if err != nil {
		t.Fatal(err)
	}
	grant, _, err := e.svc.IssueFreshAuth(ctx, "p1", goodPW, "recovery_codes")
	if err != nil {
		t.Fatal(err)
	}
	e.repo.beforeReplace = func() { e.repo.accts["p1"].version++ }
	if _, err := e.svc.RegenerateRecoveryCodes(ctx, "p1", grant); errCode(err) != "conflict" {
		t.Fatal("stale grant replaced the recovery codes")
	}
	verifiers, _ := e.repo.ActiveRecoveryVerifiers(ctx, "p1")
	if accountpolicy.VerifyRecoveryCode(testPepper, old[0], verifiers) < 0 {
		t.Fatal("existing recovery codes were retired")
	}
}

func TestChangePassword(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	grant, _, err := e.svc.IssueFreshAuth(ctx, "p1", goodPW, "password_change")
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.ChangePassword(ctx, "p1", grant, "short"); errCode(err) != "validation_failed" {
		t.Fatalf("weak accepted: %v", err)
	}
	if err := e.svc.ChangePassword(ctx, "p1", grant, newPW); err != nil {
		t.Fatal(err)
	}
	a := e.repo.accts["p1"]
	if a.version != 2 || a.sessionsRevoked != 1 || a.devicesRevoked != 0 {
		t.Fatalf("%+v", a)
	}
	if !checkPasswordCredential(a.hash, newPW) || checkPasswordCredential(a.hash, goodPW) {
		t.Fatal("hash not replaced")
	}
	if errCode(e.svc.ChangePassword(ctx, "missing", grant, newPW)) != "forbidden" {
		t.Fatal("missing account")
	}
}

func TestPasswordChangeRejectsCredentialChangeAfterFreshAuth(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	grant, _, err := e.svc.IssueFreshAuth(ctx, "p1", goodPW, "password_change")
	if err != nil {
		t.Fatal(err)
	}
	e.repo.beforeApply = func() { e.repo.accts["p1"].version++ }
	if errCode(e.svc.ChangePassword(ctx, "p1", grant, newPW)) != "conflict" {
		t.Fatal("stale grant changed the password")
	}
	if !checkPasswordCredential(e.repo.accts["p1"].hash, goodPW) {
		t.Fatal("password changed")
	}
}

func TestSavedCodeRecoveryEndToEnd(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	codes, _ := e.svc.issueRecoveryCodes(ctx, "p1", e.repo.accts["p1"].version)
	rid, err := e.svc.BeginRecovery(ctx, "saved_code", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.ProveRecovery(ctx, rid, "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA"); errCode(err) != "forbidden" {
		t.Fatalf("wrong code: %v", err)
	}
	grant, err := e.svc.ProveRecovery(ctx, rid, codes[0])
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.ProveRecovery(ctx, rid, codes[0]); errCode(err) != "forbidden" {
		t.Fatal("used code replayed")
	}
	fresh, err := e.svc.CompleteRecovery(ctx, grant, newPW)
	if err != nil || len(fresh) != 10 {
		t.Fatalf("%d %v", len(fresh), err)
	}
	a := e.repo.accts["p1"]
	if !checkPasswordCredential(a.hash, newPW) || a.sessionsRevoked != 1 || a.devicesRevoked != 1 || a.acked {
		t.Fatalf("%+v", a)
	}
	if _, err := e.svc.CompleteRecovery(ctx, grant, newPW); errCode(err) != "forbidden" {
		t.Fatal("grant reused")
	}
	// An old code from the previous set must not work against the new set.
	rid2, _ := e.svc.BeginRecovery(ctx, "saved_code", "alice")
	if _, err := e.svc.ProveRecovery(ctx, rid2, codes[1]); errCode(err) != "forbidden" {
		t.Fatal("old-set code accepted")
	}
}

func TestRecoveryDoesNotRevealAccountExistence(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	known, err1 := e.svc.BeginRecovery(ctx, "saved_code", "alice")
	unknown, err2 := e.svc.BeginRecovery(ctx, "saved_code", "nobody_here")
	if err1 != nil || err2 != nil || len(known) < 16 || len(unknown) < 16 {
		t.Fatal("begin must succeed for any identifier")
	}
	_, errKnown := e.svc.ProveRecovery(ctx, known, "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA")
	_, errUnknown := e.svc.ProveRecovery(ctx, unknown, "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA")
	if errCode(errKnown) != errCode(errUnknown) || errKnown.Error() != errUnknown.Error() {
		t.Fatalf("distinguishable: %v vs %v", errKnown, errUnknown)
	}
	if _, err := e.svc.BeginRecovery(ctx, "sms", "x"); errCode(err) != "validation_failed" {
		t.Fatal("unsupported method")
	}
}

func TestRecoveryTokenTamperAndExpiry(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	codes, _ := e.svc.issueRecoveryCodes(ctx, "p1", e.repo.accts["p1"].version)
	rid, _ := e.svc.BeginRecovery(ctx, "saved_code", "alice")
	tampered := rid[:len(rid)-3] + "AAA"
	if _, err := e.svc.ProveRecovery(ctx, tampered, codes[0]); errCode(err) != "forbidden" {
		t.Fatal("tampered token accepted")
	}
	e.t = e.t.Add(16 * time.Minute)
	if _, err := e.svc.ProveRecovery(ctx, rid, codes[0]); errCode(err) != "forbidden" {
		t.Fatal("expired token accepted")
	}
}

func TestRecoveryGrantInvalidatedByCredentialChange(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	codes, _ := e.svc.issueRecoveryCodes(ctx, "p1", e.repo.accts["p1"].version)
	rid, _ := e.svc.BeginRecovery(ctx, "saved_code", "alice")
	grant, err := e.svc.ProveRecovery(ctx, rid, codes[0])
	if err != nil {
		t.Fatal(err)
	}
	// The password changes between proof and completion.
	changeGrant, _, _ := e.svc.IssueFreshAuth(ctx, "p1", goodPW, "password_change")
	if err := e.svc.ChangePassword(ctx, "p1", changeGrant, newPW); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.CompleteRecovery(ctx, grant, "yet another long passphrase"); errCode(err) != "forbidden" {
		t.Fatalf("stale grant honoured: %v", err)
	}
}

func TestCompleteRecoveryRejectsWeakPasswordWithoutConsumingGrant(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	codes, _ := e.svc.issueRecoveryCodes(ctx, "p1", e.repo.accts["p1"].version)
	rid, _ := e.svc.BeginRecovery(ctx, "saved_code", "alice")
	grant, _ := e.svc.ProveRecovery(ctx, rid, codes[0])
	if _, err := e.svc.CompleteRecovery(ctx, grant, "short"); errCode(err) != "validation_failed" {
		t.Fatal("weak accepted")
	}
	if _, err := e.svc.CompleteRecovery(ctx, grant, newPW); err != nil {
		t.Fatalf("grant should survive a validation failure: %v", err)
	}
}

func TestEmailVerificationAndEncryptedOutbox(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	id, err := e.svc.StartEmailVerification(ctx, "p1", "Alice@Example.com")
	if err != nil || len(e.repo.outbox) != 1 {
		t.Fatalf("%v %d", err, len(e.repo.outbox))
	}
	item := e.repo.outbox[0]
	code := codeOf(t, item)
	if len(code) != 8 || bytes.Contains(item.Ciphertext, []byte(code)) {
		t.Fatal("payload not encrypted")
	}
	if item.Recipient != "alice@example.com" || !item.ExpiresAt.Equal(e.t.Add(10*time.Minute)) {
		t.Fatalf("%+v", item)
	}
	if err := e.svc.VerifyEmail(ctx, "p2", id, code); errCode(err) != "forbidden" {
		t.Fatal("other account verified someone else's challenge")
	}
	if err := e.svc.VerifyEmail(ctx, "p1", id, "00000000"); errCode(err) != "forbidden" {
		t.Fatal("wrong code")
	}
	if err := e.svc.VerifyEmail(ctx, "p1", id, code); err != nil {
		t.Fatal(err)
	}
	if e.repo.accts["p1"].email != "alice@example.com" {
		t.Fatal("email not assigned")
	}
	if err := e.svc.VerifyEmail(ctx, "p1", id, code); err == nil {
		t.Fatal("challenge reusable")
	}
}

func TestEmailUniquenessDoesNotLeak(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.repo.accts["p2"].email = "taken@example.com"
	id, err := e.svc.StartEmailVerification(ctx, "p1", "taken@example.com")
	if err != nil || len(id) != 36 {
		t.Fatalf("response must look normal: %q %v", id, err)
	}
	if len(e.repo.outbox) != 0 {
		t.Fatal("must not send mail for an address owned by another account")
	}
}

func TestEmailAssignmentRaceReportsGenericFailure(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	id, _ := e.svc.StartEmailVerification(ctx, "p1", "race@example.com")
	code := codeOf(t, e.repo.outbox[0])
	e.repo.accts["p2"].email = "race@example.com" // another account verified first
	if err := e.svc.VerifyEmail(ctx, "p1", id, code); errCode(err) != "forbidden" {
		t.Fatalf("got %v", err)
	}
	if e.repo.accts["p1"].email != "" {
		t.Fatal("email assigned despite conflict")
	}
}

func TestChallengeExpiryAndAttemptLimit(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	id, _ := e.svc.StartEmailVerification(ctx, "p1", "a@example.com")
	code := codeOf(t, e.repo.outbox[0])
	for i := 0; i < accountpolicy.EmailChallengeAttempts; i++ {
		_ = e.svc.VerifyEmail(ctx, "p1", id, "00000000")
	}
	if err := e.svc.VerifyEmail(ctx, "p1", id, code); err == nil {
		t.Fatal("correct code accepted after attempt limit")
	}
	id2, _ := e.svc.StartEmailVerification(ctx, "p2", "b@example.com")
	code2 := codeOf(t, e.repo.outbox[len(e.repo.outbox)-1])
	e.t = e.t.Add(11 * time.Minute)
	if err := e.svc.VerifyEmail(ctx, "p2", id2, code2); err == nil {
		t.Fatal("expired challenge accepted")
	}
}

func TestResendCooldown(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if _, err := e.svc.StartEmailVerification(ctx, "p1", "a@example.com"); err != nil {
		t.Fatal(err)
	}
	e.t = e.t.Add(10 * time.Second)
	if _, err := e.svc.StartEmailVerification(ctx, "p1", "a@example.com"); errCode(err) != "rate_limited" {
		t.Fatalf("cooldown not enforced: %v", err)
	}
	e.t = e.t.Add(61 * time.Second)
	if _, err := e.svc.StartEmailVerification(ctx, "p1", "a@example.com"); err != nil {
		t.Fatalf("after cooldown: %v", err)
	}
}

func TestEmailRecoveryEndToEnd(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.repo.accts["p1"].email = "alice@example.com"
	rid, err := e.svc.BeginRecovery(ctx, "email", "ALICE@example.com")
	if err != nil || len(e.repo.outbox) != 1 {
		t.Fatalf("%v outbox=%d", err, len(e.repo.outbox))
	}
	code := codeOf(t, e.repo.outbox[0])
	grant, err := e.svc.ProveRecovery(ctx, rid, code)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.CompleteRecovery(ctx, grant, newPW); err != nil {
		t.Fatal(err)
	}
	if !checkPasswordCredential(e.repo.accts["p1"].hash, newPW) {
		t.Fatal("password not reset")
	}
	// Unknown address: same response shape, no mail sent.
	before := len(e.repo.outbox)
	rid2, err := e.svc.BeginRecovery(ctx, "email", "stranger@example.com")
	if err != nil || len(rid2) < 16 || len(e.repo.outbox) != before {
		t.Fatal("unknown address must look identical and send nothing")
	}
}

func TestFreshAuthGrantBinding(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if _, _, err := e.svc.IssueFreshAuth(ctx, "p1", "wrong password entirely", "password_change"); errCode(err) != "forbidden" {
		t.Fatalf("wrong password: %v", err)
	}
	grant, ttl, err := e.svc.IssueFreshAuth(ctx, "p1", goodPW, "password_change")
	if err != nil || ttl != 300 {
		t.Fatalf("%v %d", err, ttl)
	}
	if err := e.svc.RequireFreshAuth(ctx, "p1", grant, "password_change"); err != nil {
		t.Fatalf("valid grant rejected: %v", err)
	}
	if e.svc.RequireFreshAuth(ctx, "p1", grant, "delete_account") == nil {
		t.Fatal("grant accepted for a different operation")
	}
	if e.svc.RequireFreshAuth(ctx, "p2", grant, "password_change") == nil {
		t.Fatal("grant accepted for a different account")
	}
	if e.svc.RequireFreshAuth(ctx, "p1", grant[:len(grant)-2]+"AA", "password_change") == nil {
		t.Fatal("tampered grant accepted")
	}
	if e.svc.RequireFreshAuth(ctx, "p1", "garbage", "password_change") == nil {
		t.Fatal("garbage accepted")
	}
	e.t = e.t.Add(6 * time.Minute)
	if e.svc.RequireFreshAuth(ctx, "p1", grant, "password_change") == nil {
		t.Fatal("stale grant accepted")
	}
}

func TestFreshAuthGrantDiesWithCredentialChange(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	grant, _, _ := e.svc.IssueFreshAuth(ctx, "p1", goodPW, "recovery_codes")
	changeGrant, _, _ := e.svc.IssueFreshAuth(ctx, "p1", goodPW, "password_change")
	if err := e.svc.ChangePassword(ctx, "p1", changeGrant, newPW); err != nil {
		t.Fatal(err)
	}
	if e.svc.RequireFreshAuth(ctx, "p1", grant, "recovery_codes") == nil {
		t.Fatal("grant survived a password change")
	}
}
