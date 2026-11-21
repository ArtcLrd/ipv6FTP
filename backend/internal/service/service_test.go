package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	appErrors "ipv6ftp/internal/errors"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/repository"
)

type usernameIdentityRepo struct {
	repository.IdentityRepo
	err error
}

type refreshIdentityRepo struct {
	repository.IdentityRepo
	err error
}

func (r refreshIdentityRepo) RotateRefreshToken(context.Context, string, string, string, string, string, time.Time) (models.User, string, error) {
	return models.User{}, "", r.err
}

func TestRefreshDistinguishesRejectedAndUncertainRotation(t *testing.T) {
	committed := fmt.Errorf("%w: %v", repository.ErrRefreshRotationCommitted, pgx.ErrNoRows)
	failure := errors.New("database unavailable")
	for _, tc := range []struct {
		name             string
		err              error
		wantUnauthorized bool
	}{
		{"missing token", pgx.ErrNoRows, true},
		{"token reuse", repository.ErrRefreshTokenReuse, true},
		{"database failure", failure, false},
		{"profile missing after commit", committed, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &AuthService{identity: refreshIdentityRepo{err: tc.err}}
			_, _, err := s.Refresh(context.Background(), "token", "", "")
			if errors.Is(err, appErrors.ErrUnauthorized) != tc.wantUnauthorized {
				t.Fatalf("Refresh() error = %v; unauthorized = %v", err, tc.wantUnauthorized)
			}
			if !tc.wantUnauthorized && !errors.Is(err, tc.err) {
				t.Fatalf("Refresh() did not preserve %v: %v", tc.err, err)
			}
		})
	}
}

func (r usernameIdentityRepo) FindPasswordIdentity(context.Context, string) (repository.PasswordIdentity, error) {
	return repository.PasswordIdentity{}, r.err
}

func TestUsernameExistsDistinguishesRepositoryErrors(t *testing.T) {
	failure := errors.New("database unavailable")
	for _, tc := range []struct {
		name       string
		err        error
		wantExists bool
		wantErr    error
	}{
		{"found", nil, true, nil},
		{"missing", pgx.ErrNoRows, false, nil},
		{"database failure", failure, false, failure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &AuthService{identity: usernameIdentityRepo{err: tc.err}}
			exists, err := s.UsernameExists(context.Background(), "alice")
			if exists != tc.wantExists || !errors.Is(err, tc.wantErr) {
				t.Fatalf("UsernameExists() = %v, %v; want %v, %v", exists, err, tc.wantExists, tc.wantErr)
			}
		})
	}
}

func TestLoginDistinguishesMissingIdentityFromRepositoryFailure(t *testing.T) {
	failure := errors.New("database unavailable")
	for _, tc := range []struct {
		name       string
		err        error
		wantStatus int
	}{
		{"missing", pgx.ErrNoRows, 401},
		{"database failure", failure, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &AuthService{identity: usernameIdentityRepo{err: tc.err}}
			_, _, _, err := s.Login(context.Background(), models.LoginRequest{Username: "alice", Password: "password"}, "", "")
			var appErr *appErrors.AppError
			if tc.wantStatus != 0 {
				if !errors.As(err, &appErr) || appErr.Status != tc.wantStatus {
					t.Fatalf("unexpected error: %v", err)
				}
			} else if !errors.Is(err, failure) {
				t.Fatalf("database failure not preserved: %v", err)
			}
		})
	}
}

func TestRegistrationConflictsIdentifyTheActualConstraint(t *testing.T) {
	for _, tc := range []struct {
		constraint string
		wantCode   string
	}{
		{"uq_accounts_username_ci", "USERNAME_TAKEN"},
		{"uq_devices_key", "DEVICE_IDENTITY_CONFLICT"},
		{"unrelated_constraint", ""},
	} {
		t.Run(tc.constraint, func(t *testing.T) {
			databaseErr := &pgconn.PgError{Code: "23505", ConstraintName: tc.constraint}
			err := registrationError(databaseErr)
			var appErr *appErrors.AppError
			if tc.wantCode == "" {
				if !errors.Is(err, databaseErr) {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Code != tc.wantCode {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

type testUserRepo struct {
	users       map[string]models.User
	usernameErr error
}

func (r *testUserRepo) Create(ctx context.Context, username, passwordHash, ipAddr string) (models.User, error) {
	return models.User{}, nil
}
func (r *testUserRepo) GetByUsername(ctx context.Context, username string) (models.User, error) {
	return models.User{}, r.usernameErr
}

func TestLegacyUsernameExistsDistinguishesRepositoryErrors(t *testing.T) {
	failure := errors.New("database unavailable")
	for _, tc := range []struct {
		name       string
		err        error
		wantExists bool
		wantErr    error
	}{
		{"found", nil, true, nil},
		{"missing", pgx.ErrNoRows, false, nil},
		{"database failure", failure, false, failure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &AuthService{users: &testUserRepo{usernameErr: tc.err}}
			exists, err := s.UsernameExists(context.Background(), "alice")
			if exists != tc.wantExists || !errors.Is(err, tc.wantErr) {
				t.Fatalf("UsernameExists() = %v, %v; want %v, %v", exists, err, tc.wantExists, tc.wantErr)
			}
		})
	}
}
func (r *testUserRepo) GetByID(ctx context.Context, id string) (models.User, error) {
	return r.users[id], nil
}
func (r *testUserRepo) UpdateStatusIP(ctx context.Context, id, ipAddr, status string) error {
	user := r.users[id]
	user.IPAddr = ipAddr
	user.Status = status
	r.users[id] = user
	return nil
}
func (r *testUserRepo) Search(ctx context.Context, query, excludeID string) ([]models.UserPublic, error) {
	return []models.UserPublic{}, nil
}
func (r *testUserRepo) ResetStatuses(ctx context.Context) error               { return nil }
func (r *testUserRepo) TouchOnline(ctx context.Context, when time.Time) error { return nil }

type testContactRepo struct {
	contacts map[string]map[string]bool
}

func (r *testContactRepo) List(ctx context.Context, ownerID string) ([]models.Contact, error) {
	out := make([]models.Contact, 0)
	for contactID := range r.contacts[ownerID] {
		out = append(out, models.Contact{ID: contactID, Username: contactID, Status: "online"})
	}
	return out, nil
}
func (r *testContactRepo) ListRelatedIDs(ctx context.Context, userID string) ([]string, error) {
	return []string{}, nil
}
func (r *testContactRepo) Add(ctx context.Context, ownerID, contactID string) error {
	if r.contacts[ownerID] == nil {
		r.contacts[ownerID] = map[string]bool{}
	}
	r.contacts[ownerID][contactID] = true
	return nil
}
func (r *testContactRepo) Delete(ctx context.Context, ownerID, contactID string) (bool, error) {
	if r.contacts[ownerID] == nil || !r.contacts[ownerID][contactID] {
		return false, nil
	}
	delete(r.contacts[ownerID], contactID)
	return true, nil
}

type testPhonebookRepo struct {
	entry         *models.ResolvedAddress
	heartbeatSeen bool
}

func (r *testPhonebookRepo) Resolve(ctx context.Context, username string) (*models.ResolvedAddress, error) {
	return r.entry, nil
}
func (r *testPhonebookRepo) Heartbeat(ctx context.Context, userID string, req models.HeartbeatRequest, ipAddr string) error {
	r.heartbeatSeen = true
	return nil
}
func (r *testPhonebookRepo) UpdatePublicKey(ctx context.Context, userID, publicKey string) error {
	return nil
}

func TestContactLifecycle(t *testing.T) {
	userRepo := &testUserRepo{users: map[string]models.User{}}
	contactRepo := &testContactRepo{contacts: map[string]map[string]bool{}}
	svc := NewUserService(userRepo, contactRepo, repository.NewMemoryCacheRepo(), nil)
	ctx := context.Background()

	if err := svc.AddContact(ctx, "u1", "u2"); err != nil {
		t.Fatalf("AddContact() error = %v", err)
	}
	contacts, err := svc.ListContacts(ctx, "u1")
	if err != nil {
		t.Fatalf("ListContacts() error = %v", err)
	}
	if len(contacts) != 1 {
		t.Fatalf("contacts len = %d, want 1", len(contacts))
	}
	if err := svc.DeleteContact(ctx, "u1", "u2"); err != nil {
		t.Fatalf("DeleteContact() error = %v", err)
	}
	contacts, err = svc.ListContacts(ctx, "u1")
	if err != nil {
		t.Fatalf("ListContacts() error = %v", err)
	}
	if len(contacts) != 0 {
		t.Fatalf("contacts len = %d, want 0", len(contacts))
	}
}

func TestUpdateIPWritesPresenceCache(t *testing.T) {
	userRepo := &testUserRepo{users: map[string]models.User{"u1": {ID: "u1", Username: "alice"}}}
	cache := repository.NewMemoryCacheRepo()
	svc := NewUserService(userRepo, &testContactRepo{contacts: map[string]map[string]bool{}}, cache, nil)
	ctx := context.Background()

	if err := svc.UpdateIP(ctx, "u1", "2401:db8::1"); err != nil {
		t.Fatalf("UpdateIP() error = %v", err)
	}
	value, ok, err := cache.GetString(ctx, "ipv6ftp:presence:u1")
	if err != nil {
		t.Fatalf("cache.GetString() error = %v", err)
	}
	if !ok || value == "" {
		t.Fatalf("presence cache missing, ok=%v value=%q", ok, value)
	}
}

func TestPhonebookHeartbeatAndLookup(t *testing.T) {
	ipv6 := "2401:db8::7"
	repo := &testPhonebookRepo{
		entry: &models.ResolvedAddress{
			UserID:      "u2",
			Username:    "bob",
			IPv6Address: &ipv6,
			IsOnline:    true,
		},
	}
	svc := NewPhonebookService(repo, repository.NewMemoryCacheRepo())
	ctx := context.Background()

	if err := svc.Heartbeat(ctx, "u2", models.HeartbeatRequest{IPv6: ipv6, Online: true}, "2401:db8::7"); err != nil {
		t.Fatalf("Heartbeat() error = %v", err)
	}
	if !repo.heartbeatSeen {
		t.Fatal("Heartbeat() did not call repo")
	}
	resolved, err := svc.Lookup(ctx, "bob")
	if err != nil {
		t.Fatalf("Lookup() error = %v", err)
	}
	if resolved == nil || resolved.Username != "bob" {
		t.Fatalf("resolved = %#v", resolved)
	}
}
