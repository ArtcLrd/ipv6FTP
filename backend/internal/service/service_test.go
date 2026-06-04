package service

import (
	"context"
	"testing"
	"time"

	"ipv6ftp/internal/models"
	"ipv6ftp/internal/repository"
)

type testUserRepo struct {
	users map[string]models.User
}

func (r *testUserRepo) Create(ctx context.Context, username, passwordHash, ipAddr string) (models.User, error) {
	return models.User{}, nil
}
func (r *testUserRepo) GetByUsername(ctx context.Context, username string) (models.User, error) {
	return models.User{}, nil
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
