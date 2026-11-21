package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"ipv6ftp/internal/accountpolicy"
	"ipv6ftp/internal/transport/http/contracts"
)

type fakeFresh struct{}

func (fakeFresh) RequireFreshAuth(_ context.Context, _, grant, _ string) error {
	if grant != "ok" {
		return apiErr(contracts.CodeForbidden, "Fresh authentication required")
	}
	return nil
}

type lifeAcct struct {
	username, hash string
	changedAt      *time.Time
	deadline       *time.Time
	former         map[string]bool
}

type fakeLifeRepo struct {
	accts    map[string]*lifeAcct
	retired  map[string]bool
	sessions map[string][]SessionInfo
	revoked  map[string]bool
}

func newFakeLife() *fakeLifeRepo {
	return &fakeLifeRepo{accts: map[string]*lifeAcct{}, retired: map[string]bool{}, sessions: map[string][]SessionInfo{}, revoked: map[string]bool{}}
}

func (f *fakeLifeRepo) acct(pid string) (*lifeAcct, error) {
	a, ok := f.accts[pid]
	if !ok {
		return nil, ErrAccountNotFound
	}
	return a, nil
}

func (f *fakeLifeRepo) GetProfile(_ context.Context, pid string) (AccountProfile, error) {
	a, err := f.acct(pid)
	if err != nil {
		return AccountProfile{}, err
	}
	return AccountProfile{Username: a.username, Revision: 1, RecoveryAcked: true, UsernameChangedAt: a.changedAt, DeletionDeadline: a.deadline}, nil
}

func (f *fakeLifeRepo) takenBy(canon string) (string, bool) {
	for pid, a := range f.accts {
		if strings.EqualFold(a.username, canon) {
			return pid, true
		}
		if a.former[canon] {
			return pid, true
		}
	}
	return "", f.retired[canon]
}

func (f *fakeLifeRepo) UsernameAvailable(_ context.Context, canon string) (bool, error) {
	_, taken := f.takenBy(canon)
	return !taken, nil
}

func (f *fakeLifeRepo) ChangeUsername(_ context.Context, pid, canon string, now time.Time) error {
	a, err := f.acct(pid)
	if err != nil {
		return err
	}
	if a.deadline != nil {
		return ErrPendingDeletion
	}
	if strings.EqualFold(a.username, canon) {
		return ErrUsernameUnchanged
	}
	if err := accountpolicy.CheckUsernameChange(a.changedAt, now); err != nil {
		return err
	}
	if owner, taken := f.takenBy(canon); taken && owner != pid {
		return ErrUsernameTaken
	}
	if a.former == nil {
		a.former = map[string]bool{}
	}
	delete(a.former, canon) // reclaiming an owned former name
	a.former[strings.ToLower(a.username)] = true
	a.username, a.changedAt = canon, &now
	return nil
}

func (f *fakeLifeRepo) RequestDeletion(_ context.Context, pid string, now time.Time) (time.Time, error) {
	a, err := f.acct(pid)
	if err != nil {
		return time.Time{}, err
	}
	if a.deadline == nil {
		d := accountpolicy.DeletionDeadline(now)
		a.deadline = &d
		_ = f.RevokeAllSessions(context.Background(), pid)
	}
	return *a.deadline, nil
}

func (f *fakeLifeRepo) CancelDeletion(_ context.Context, pid string, now time.Time) error {
	a, err := f.acct(pid)
	if err != nil {
		return err
	}
	if a.deadline == nil {
		return ErrNotPendingDeletion
	}
	if !accountpolicy.DeletionCancelable(*a.deadline, now) {
		return ErrDeletionExpired
	}
	a.deadline = nil
	return nil
}

func (f *fakeLifeRepo) FindAccountForLogin(_ context.Context, username string) (string, string, error) {
	for pid, a := range f.accts {
		if strings.EqualFold(a.username, username) {
			return pid, a.hash, nil
		}
	}
	return "", "", ErrAccountNotFound
}

func (f *fakeLifeRepo) ListSessions(_ context.Context, pid string, limit int) ([]SessionInfo, error) {
	s := f.sessions[pid]
	if len(s) > limit {
		s = s[:limit]
	}
	return s, nil
}

func (f *fakeLifeRepo) RevokeSession(_ context.Context, pid, sid string) (bool, error) {
	for _, s := range f.sessions[pid] {
		if s.SessionID == sid {
			f.revoked[sid] = true
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeLifeRepo) RevokeAllSessions(_ context.Context, pid string) error {
	for _, s := range f.sessions[pid] {
		f.revoked[s.SessionID] = true
	}
	return nil
}

func lifeFixture(t *testing.T) (*AccountLifecycleService, *fakeLifeRepo, *time.Time) {
	t.Helper()
	hash, err := hashPasswordCredential("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	repo := newFakeLife()
	repo.accts["p1"] = &lifeAcct{username: "alice", hash: hash}
	repo.accts["p2"] = &lifeAcct{username: "bob", hash: hash}
	svc, err := NewAccountLifecycleService(repo, fakeFresh{})
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return clock }
	return svc, repo, &clock
}

func TestUsernameChangeRequiresFreshAuthAndRespectsCooldown(t *testing.T) {
	svc, repo, clock := lifeFixture(t)
	ctx := context.Background()
	if err := svc.ChangeUsername(ctx, "p1", "stale", "alice_two"); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("without fresh auth: %v", err)
	}
	if repo.accts["p1"].username != "alice" {
		t.Fatal("rename happened without fresh auth")
	}
	if err := svc.ChangeUsername(ctx, "p1", "ok", "alice_two"); err != nil {
		t.Fatal(err)
	}
	if err := svc.ChangeUsername(ctx, "p1", "ok", "alice_three"); errCode(err) != contracts.CodeRateLimited {
		t.Fatalf("second change inside 30 days: %v", err)
	}
	*clock = clock.Add(accountpolicy.UsernameChangeGap + time.Second)
	if err := svc.ChangeUsername(ctx, "p1", "ok", "alice_three"); err != nil {
		t.Fatalf("after cooldown: %v", err)
	}
}

func TestFailedUsernameChangeDoesNotConsumeCooldown(t *testing.T) {
	svc, repo, _ := lifeFixture(t)
	ctx := context.Background()
	if err := svc.ChangeUsername(ctx, "p1", "ok", "bob"); errCode(err) != contracts.CodeConflict {
		t.Fatalf("taking a live name: %v", err)
	}
	if repo.accts["p1"].changedAt != nil {
		t.Fatal("failed attempt stamped the cooldown")
	}
	if err := svc.ChangeUsername(ctx, "p1", "ok", "alice_fresh"); err != nil {
		t.Fatal(err)
	}
}

func TestFormerNamesStayReservedToTheirOwner(t *testing.T) {
	svc, _, clock := lifeFixture(t)
	ctx := context.Background()
	if err := svc.ChangeUsername(ctx, "p1", "ok", "alice_new"); err != nil {
		t.Fatal(err)
	}
	if ok, err := svc.UsernameAvailable(ctx, "alice"); err != nil || ok {
		t.Fatalf("former name must read as unavailable: %v %v", ok, err)
	}
	*clock = clock.Add(accountpolicy.UsernameChangeGap + time.Second)
	if err := svc.ChangeUsername(ctx, "p2", "ok", "alice"); errCode(err) != contracts.CodeConflict {
		t.Fatalf("another account took a reserved name: %v", err)
	}
	if err := svc.ChangeUsername(ctx, "p1", "ok", "alice"); err != nil {
		t.Fatalf("owner could not reclaim: %v", err)
	}
}

func TestChangeToSameOrInvalidNameIsRejected(t *testing.T) {
	svc, _, _ := lifeFixture(t)
	ctx := context.Background()
	if err := svc.ChangeUsername(ctx, "p1", "ok", "alice"); errCode(err) != contracts.CodeValidationFailed {
		t.Fatalf("same name: %v", err)
	}
	if err := svc.ChangeUsername(ctx, "p1", "ok", "x"); errCode(err) != contracts.CodeValidationFailed {
		t.Fatalf("too short: %v", err)
	}
	if _, err := svc.UsernameAvailable(ctx, "bad name!"); errCode(err) != contracts.CodeValidationFailed {
		t.Fatalf("invalid availability probe: %v", err)
	}
}

func TestRetiredNamesAreUnavailable(t *testing.T) {
	svc, repo, _ := lifeFixture(t)
	repo.retired["ghost"] = true
	if ok, _ := svc.UsernameAvailable(context.Background(), "ghost"); ok {
		t.Fatal("retired name offered")
	}
	if ok, _ := svc.UsernameAvailable(context.Background(), "brand_new"); !ok {
		t.Fatal("free name reported unavailable")
	}
}

func TestDeletionIsFreshAuthGatedIdempotentAndRevokesSessions(t *testing.T) {
	svc, repo, clock := lifeFixture(t)
	ctx := context.Background()
	repo.sessions["p1"] = []SessionInfo{{SessionID: "s1"}, {SessionID: "s2"}}
	if _, err := svc.RequestDeletion(ctx, "p1", "stale"); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("no fresh auth: %v", err)
	}
	d1, err := svc.RequestDeletion(ctx, "p1", "ok")
	if err != nil {
		t.Fatal(err)
	}
	if !d1.Equal(clock.Add(accountpolicy.DeletionWindow)) {
		t.Fatalf("deadline %v", d1)
	}
	if !repo.revoked["s1"] || !repo.revoked["s2"] {
		t.Fatal("sessions survived deletion request")
	}
	*clock = clock.Add(time.Hour)
	d2, err := svc.RequestDeletion(ctx, "p1", "ok")
	if err != nil || !d2.Equal(d1) {
		t.Fatalf("repeat request must keep the original deadline: %v %v", d2, err)
	}
	st, _ := svc.DeletionStatus(ctx, "p1")
	if st.State != "pending_deletion" || st.Deadline == nil {
		t.Fatalf("status %+v", st)
	}
	if err := svc.ChangeUsername(ctx, "p1", "ok", "late_name"); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("rename while pending deletion: %v", err)
	}
}

func TestCancelDeletionRulesAndGenericFailures(t *testing.T) {
	svc, _, clock := lifeFixture(t)
	ctx := context.Background()
	pw := "correct horse battery staple"
	if _, err := svc.RequestDeletion(ctx, "p1", "ok"); err != nil {
		t.Fatal(err)
	}
	for name, args := range map[string][2]string{"wrong password": {"alice", "nope nope nope nope"}, "unknown user": {"nobody", pw}, "not pending": {"bob", pw}} {
		if err := svc.CancelDeletion(ctx, args[0], args[1]); errCode(err) != contracts.CodeForbidden {
			t.Errorf("%s: %v", name, err)
		}
	}
	if err := svc.CancelDeletion(ctx, "Alice", pw); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if st, _ := svc.DeletionStatus(ctx, "p1"); st.State != "active" {
		t.Fatalf("not restored: %+v", st)
	}
	if _, err := svc.RequestDeletion(ctx, "p1", "ok"); err != nil {
		t.Fatal(err)
	}
	*clock = clock.Add(accountpolicy.DeletionWindow)
	if err := svc.CancelDeletion(ctx, "alice", pw); errCode(err) != contracts.CodeForbidden {
		t.Fatalf("cancel after the deadline must lose: %v", err)
	}
}

func TestSessionsAreScopedToTheCaller(t *testing.T) {
	svc, repo, _ := lifeFixture(t)
	ctx := context.Background()
	now := time.Now()
	repo.sessions["p1"] = []SessionInfo{{SessionID: "mine", DeviceID: "d1", IssuedAt: now, ExpiresAt: now.Add(time.Hour)}}
	repo.sessions["p2"] = []SessionInfo{{SessionID: "theirs", DeviceID: "d2", IssuedAt: now, ExpiresAt: now.Add(time.Hour)}}
	list, err := svc.ListSessions(ctx, "p1", "mine")
	if err != nil || len(list.Sessions) != 1 || !list.Sessions[0].Current {
		t.Fatalf("list %+v %v", list, err)
	}
	if err := svc.RevokeSession(ctx, "p1", "theirs"); errCode(err) != contracts.CodeNotFound {
		t.Fatalf("foreign session: %v", err)
	}
	if repo.revoked["theirs"] {
		t.Fatal("foreign session was revoked")
	}
	if err := svc.RevokeSession(ctx, "p1", "mine"); err != nil || !repo.revoked["mine"] {
		t.Fatalf("own session: %v", err)
	}
	if err := svc.RevokeAllSessions(ctx, "p2"); err != nil || !repo.revoked["theirs"] {
		t.Fatalf("revoke all: %v", err)
	}
}

func TestProfileReportsStateAndNextChange(t *testing.T) {
	svc, _, _ := lifeFixture(t)
	ctx := context.Background()
	if err := svc.ChangeUsername(ctx, "p1", "ok", "alice_two"); err != nil {
		t.Fatal(err)
	}
	p, err := svc.Profile(ctx, "p1")
	if err != nil || p.Username != "alice_two" || p.AccountState != "active" || p.NextUsernameChangeAt == nil {
		t.Fatalf("%+v %v", p, err)
	}
	if _, err := svc.Profile(ctx, "ghost"); errCode(err) != contracts.CodeSessionInvalid {
		t.Fatalf("unknown principal: %v", err)
	}
}
