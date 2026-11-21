package service

import (
	"context"
	"errors"
	"sync"
	"time"

	"ipv6ftp/internal/accountpolicy"
	"ipv6ftp/internal/transport/http/contracts"
)

// Lifecycle repository errors.
var (
	ErrUsernameTaken      = errors.New("username unavailable")
	ErrUsernameUnchanged  = errors.New("username unchanged")
	ErrPendingDeletion    = errors.New("account is pending deletion")
	ErrNotPendingDeletion = errors.New("account is not pending deletion")
	ErrDeletionExpired    = errors.New("deletion deadline passed")
)

type AccountProfile struct {
	Username          string
	Revision          int64
	RecoveryAcked     bool
	UsernameChangedAt *time.Time
	DeletionDeadline  *time.Time
}

type SessionInfo struct {
	SessionID string
	DeviceID  string
	IssuedAt  time.Time
	ExpiresAt time.Time
	RevokedAt *time.Time
}

// AccountLifecycleRepo is the persistence boundary for profile/session/deletion flows.
// Implementations make each mutating method atomic and lock the account row, so a
// rename, deletion request and cancellation cannot interleave.
type AccountLifecycleRepo interface {
	GetProfile(ctx context.Context, principalID string) (AccountProfile, error)
	// UsernameAvailable is false for current, former (any owner) and retired names.
	UsernameAvailable(ctx context.Context, canonical string) (bool, error)
	// ChangeUsername reserves the old name to the owner, applies the new one and stamps the
	// change time. It returns accountpolicy.ErrUsernameCooldown, ErrUsernameTaken,
	// ErrUsernameUnchanged or ErrPendingDeletion without modifying anything.
	ChangeUsername(ctx context.Context, principalID, newCanonical string, now time.Time) error
	// RequestDeletion is idempotent: a second call returns the original deadline. It revokes every session.
	RequestDeletion(ctx context.Context, principalID string, now time.Time) (time.Time, error)
	// CancelDeletion returns ErrNotPendingDeletion or ErrDeletionExpired when it cannot win.
	CancelDeletion(ctx context.Context, principalID string, now time.Time) error
	// FindAccountForLogin returns the account id and password hash for a current username.
	FindAccountForLogin(ctx context.Context, username string) (principalID, passwordHash string, err error)

	ListSessions(ctx context.Context, principalID string, limit int) ([]SessionInfo, error)
	// RevokeSession reports false when the session does not exist or belongs to someone else.
	RevokeSession(ctx context.Context, principalID, sessionID string) (bool, error)
	RevokeAllSessions(ctx context.Context, principalID string) error
}

// FreshAuthChecker is satisfied by AccountSecurityService.
type FreshAuthChecker interface {
	RequireFreshAuth(ctx context.Context, principalID, grant, operation string) error
}

type AccountLifecycleService struct {
	repo  AccountLifecycleRepo
	fresh FreshAuthChecker
	now   func() time.Time
}

func NewAccountLifecycleService(repo AccountLifecycleRepo, fresh FreshAuthChecker) (*AccountLifecycleService, error) {
	if repo == nil || fresh == nil {
		return nil, errors.New("account lifecycle needs a repository and a fresh-auth checker")
	}
	return &AccountLifecycleService{repo: repo, fresh: fresh, now: time.Now}, nil
}

var (
	dummyOnce sync.Once
	dummyHash string
)

// dummyPasswordHash is a valid hash of a throwaway password, used to equalise timing.
func dummyPasswordHash() string {
	dummyOnce.Do(func() { dummyHash, _ = hashPasswordCredential("timing-equaliser-not-a-credential") })
	return dummyHash
}

func lifecycleUnavailable() error {
	return apiErr(contracts.CodeUnavailable, "Temporarily unavailable")
}

func accountState(p AccountProfile) string {
	if p.DeletionDeadline != nil {
		return "pending_deletion"
	}
	if !p.RecoveryAcked {
		return "recovery_setup"
	}
	return "active"
}

func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func (s *AccountLifecycleService) Profile(ctx context.Context, principalID string) (contracts.ProfileResponse, error) {
	p, err := s.repo.GetProfile(ctx, principalID)
	if errors.Is(err, ErrAccountNotFound) {
		return contracts.ProfileResponse{}, apiErr(contracts.CodeSessionInvalid, "Sign in required")
	}
	if err != nil {
		return contracts.ProfileResponse{}, lifecycleUnavailable()
	}
	out := contracts.ProfileResponse{Username: p.Username, Revision: p.Revision, AccountState: accountState(p), RecoveryAcknowledged: p.RecoveryAcked}
	if p.UsernameChangedAt != nil {
		next := rfc3339(p.UsernameChangedAt.Add(accountpolicy.UsernameChangeGap))
		out.NextUsernameChangeAt = &next
	}
	return out, nil
}

// UsernameAvailable is a bounded public surface. Invalid names are a validation error, never
// "available"; reservations are indistinguishable from taken names; repository failures are
// service failures, not availability results.
func (s *AccountLifecycleService) UsernameAvailable(ctx context.Context, username string) (bool, error) {
	canon, err := accountpolicy.ValidateNewUsername(username)
	if err != nil {
		return false, apiErr(contracts.CodeValidationFailed, "Invalid username")
	}
	ok, err := s.repo.UsernameAvailable(ctx, canon)
	if err != nil {
		return false, lifecycleUnavailable()
	}
	return ok, nil
}

func (s *AccountLifecycleService) ChangeUsername(ctx context.Context, principalID, grant, username string) error {
	canon, err := accountpolicy.ValidateNewUsername(username)
	if err != nil {
		return apiErr(contracts.CodeValidationFailed, "Invalid username")
	}
	if err := s.fresh.RequireFreshAuth(ctx, principalID, grant, "username_change"); err != nil {
		return err
	}
	err = s.repo.ChangeUsername(ctx, principalID, canon, s.now())
	switch {
	case err == nil:
		return nil
	case errors.Is(err, accountpolicy.ErrUsernameCooldown):
		return apiErr(contracts.CodeRateLimited, "Username was changed too recently")
	case errors.Is(err, ErrUsernameTaken):
		return apiErr(contracts.CodeConflict, "Username unavailable")
	case errors.Is(err, ErrUsernameUnchanged):
		return apiErr(contracts.CodeValidationFailed, "That is already your username")
	case errors.Is(err, ErrPendingDeletion):
		return apiErr(contracts.CodeForbidden, "Account is pending deletion")
	case errors.Is(err, ErrAccountNotFound):
		return apiErr(contracts.CodeSessionInvalid, "Sign in required")
	}
	return lifecycleUnavailable()
}

func (s *AccountLifecycleService) RequestDeletion(ctx context.Context, principalID, grant string) (time.Time, error) {
	if err := s.fresh.RequireFreshAuth(ctx, principalID, grant, "delete_account"); err != nil {
		return time.Time{}, err
	}
	deadline, err := s.repo.RequestDeletion(ctx, principalID, s.now())
	if errors.Is(err, ErrAccountNotFound) {
		return time.Time{}, apiErr(contracts.CodeSessionInvalid, "Sign in required")
	}
	if err != nil {
		return time.Time{}, lifecycleUnavailable()
	}
	return deadline, nil
}

func (s *AccountLifecycleService) DeletionStatus(ctx context.Context, principalID string) (contracts.DeletionStatusResponse, error) {
	p, err := s.repo.GetProfile(ctx, principalID)
	if errors.Is(err, ErrAccountNotFound) {
		return contracts.DeletionStatusResponse{}, apiErr(contracts.CodeSessionInvalid, "Sign in required")
	}
	if err != nil {
		return contracts.DeletionStatusResponse{}, lifecycleUnavailable()
	}
	if p.DeletionDeadline == nil {
		return contracts.DeletionStatusResponse{State: "active"}, nil
	}
	d := rfc3339(*p.DeletionDeadline)
	return contracts.DeletionStatusResponse{State: "pending_deletion", Deadline: &d}, nil
}

// CancelDeletion needs no session (they were revoked). It proves the password directly and
// answers every non-success identically so it cannot be used to probe accounts. It restores
// the account only; the caller must sign in again to obtain new authorization.
func (s *AccountLifecycleService) CancelDeletion(ctx context.Context, username, password string) error {
	denied := apiErr(contracts.CodeForbidden, "Could not cancel deletion")
	pid, hash, err := s.repo.FindAccountForLogin(ctx, username)
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			// Burn comparable work so timing does not reveal whether the account exists.
			checkPasswordCredential(dummyPasswordHash(), password)
			return denied
		}
		return lifecycleUnavailable()
	}
	if !checkPasswordCredential(hash, password) {
		return denied
	}
	err = s.repo.CancelDeletion(ctx, pid, s.now())
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrNotPendingDeletion), errors.Is(err, ErrDeletionExpired), errors.Is(err, ErrAccountNotFound):
		return denied
	}
	return lifecycleUnavailable()
}

// DeletionStatusForCredentials answers a signed-out user whose sessions were revoked by the
// deletion request. Failures are as generic as CancelDeletion's.
func (s *AccountLifecycleService) DeletionStatusForCredentials(ctx context.Context, username, password string) (contracts.DeletionStatusResponse, error) {
	denied := apiErr(contracts.CodeForbidden, "Could not read deletion status")
	pid, hash, err := s.repo.FindAccountForLogin(ctx, username)
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			checkPasswordCredential(dummyPasswordHash(), password)
			return contracts.DeletionStatusResponse{}, denied
		}
		return contracts.DeletionStatusResponse{}, lifecycleUnavailable()
	}
	if !checkPasswordCredential(hash, password) {
		return contracts.DeletionStatusResponse{}, denied
	}
	return s.DeletionStatus(ctx, pid)
}

const maxListedSessions = 50

func (s *AccountLifecycleService) ListSessions(ctx context.Context, principalID, currentSessionID string) (contracts.SessionsResponse, error) {
	items, err := s.repo.ListSessions(ctx, principalID, maxListedSessions)
	if err != nil {
		return contracts.SessionsResponse{}, lifecycleUnavailable()
	}
	out := contracts.SessionsResponse{Sessions: make([]contracts.SessionItem, 0, len(items))}
	for _, it := range items {
		item := contracts.SessionItem{SessionID: it.SessionID, DeviceID: it.DeviceID, IssuedAt: rfc3339(it.IssuedAt), ExpiresAt: rfc3339(it.ExpiresAt), Current: it.SessionID == currentSessionID}
		if it.RevokedAt != nil {
			r := rfc3339(*it.RevokedAt)
			item.RevokedAt = &r
		}
		out.Sessions = append(out.Sessions, item)
	}
	return out, nil
}

// RevokeSession is scoped to the caller's own sessions; a foreign or unknown id is not_found.
func (s *AccountLifecycleService) RevokeSession(ctx context.Context, principalID, sessionID string) error {
	ok, err := s.repo.RevokeSession(ctx, principalID, sessionID)
	if err != nil {
		return lifecycleUnavailable()
	}
	if !ok {
		return apiErr(contracts.CodeNotFound, "Not found")
	}
	return nil
}

func (s *AccountLifecycleService) RevokeAllSessions(ctx context.Context, principalID string) error {
	if err := s.repo.RevokeAllSessions(ctx, principalID); err != nil {
		return lifecycleUnavailable()
	}
	return nil
}
