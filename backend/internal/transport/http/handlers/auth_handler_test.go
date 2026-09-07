package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/service"
)

type fakeUserRepo struct {
	byID    map[string]models.User
	byName  map[string]models.User
	counter int
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{
		byID:   map[string]models.User{},
		byName: map[string]models.User{},
	}
}

func (f *fakeUserRepo) Create(ctx context.Context, username, passwordHash, ipAddr string) (models.User, error) {
	if _, exists := f.byName[username]; exists {
		return models.User{}, errors.New("duplicate username")
	}
	f.counter++
	user := models.User{
		ID:           "u" + string(rune('0'+f.counter)),
		Username:     username,
		PasswordHash: passwordHash,
		Role:         "user",
		Status:       "online",
		IPAddr:       ipAddr,
	}
	f.byID[user.ID] = user
	f.byName[user.Username] = user
	return user, nil
}

func (f *fakeUserRepo) GetByUsername(ctx context.Context, username string) (models.User, error) {
	user, ok := f.byName[username]
	if !ok {
		return models.User{}, errors.New("not found")
	}
	return user, nil
}

func (f *fakeUserRepo) GetByID(ctx context.Context, id string) (models.User, error) {
	user, ok := f.byID[id]
	if !ok {
		return models.User{}, errors.New("not found")
	}
	return user, nil
}

func (f *fakeUserRepo) UpdateStatusIP(ctx context.Context, id, ipAddr, status string) error {
	user, ok := f.byID[id]
	if !ok {
		return errors.New("not found")
	}
	user.IPAddr = ipAddr
	user.Status = status
	f.byID[id] = user
	f.byName[user.Username] = user
	return nil
}

func (f *fakeUserRepo) Search(ctx context.Context, query, excludeID string) ([]models.UserPublic, error) {
	return []models.UserPublic{}, nil
}
func (f *fakeUserRepo) ResetStatuses(ctx context.Context) error               { return nil }
func (f *fakeUserRepo) TouchOnline(ctx context.Context, when time.Time) error { return nil }

type fakeContactRepo struct{}

func (f *fakeContactRepo) List(ctx context.Context, ownerID string) ([]models.Contact, error) {
	return []models.Contact{}, nil
}
func (f *fakeContactRepo) ListRelatedIDs(ctx context.Context, userID string) ([]string, error) {
	return []string{}, nil
}
func (f *fakeContactRepo) Add(ctx context.Context, ownerID, contactID string) error { return nil }
func (f *fakeContactRepo) Delete(ctx context.Context, ownerID, contactID string) (bool, error) {
	return true, nil
}

type fakeSessionRepo struct{}

func (f *fakeSessionRepo) Create(ctx context.Context, session models.Session) error { return nil }
func (f *fakeSessionRepo) RevokeByUser(ctx context.Context, userID string) error    { return nil }
func (f *fakeSessionRepo) Revoke(ctx context.Context, sessionID string) error       { return nil }
func (f *fakeSessionRepo) IsRevoked(ctx context.Context, sessionID string) (bool, error) {
	return false, nil
}

func buildAuthHandler() (*AuthHandler, config.Config) {
	cfg := config.Config{
		JWTSecret:  "secret",
		BcryptCost: 4,
	}
	userRepo := newFakeUserRepo()
	contactRepo := &fakeContactRepo{}
	sessionRepo := &fakeSessionRepo{}
	cache := repository.NewMemoryCacheRepo()
	authSvc := service.NewAuthService(cfg, userRepo, contactRepo, sessionRepo, cache, nil)
	return NewAuthHandler(cfg, authSvc), cfg
}

func decodeJSONBody(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json decode failed: %v (body=%q)", err, rr.Body.String())
	}
	return payload
}

func TestRegisterAndLoginReturnTokenPair(t *testing.T) {
	handler, _ := buildAuthHandler()
	body := bytes.NewBufferString(`{"username":"alice","password":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", body)
	rr := httptest.NewRecorder()
	handler.Register(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("register status = %d, want %d", rr.Code, http.StatusOK)
	}
	if cookies := rr.Header().Values("Set-Cookie"); len(cookies) != 0 {
		t.Fatalf("register should not set cookies, got %v", cookies)
	}
	registerPayload := decodeJSONBody(t, rr)
	if registerPayload["access_token"] == "" || registerPayload["refresh_token"] == "" {
		t.Fatalf("register token pair missing: %#v", registerPayload)
	}

	loginBody := bytes.NewBufferString(`{"username":"alice","password":"password123"}`)
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", loginBody)
	loginRR := httptest.NewRecorder()
	handler.Login(loginRR, loginReq)
	if loginRR.Code != http.StatusOK {
		t.Fatalf("login status = %d, want %d", loginRR.Code, http.StatusOK)
	}
	loginPayload := decodeJSONBody(t, loginRR)
	if loginPayload["access_token"] == "" || loginPayload["refresh_token"] == "" {
		t.Fatalf("login token pair missing: %#v", loginPayload)
	}
}

func TestRefreshConsumesBodyAndReturnsTokenPair(t *testing.T) {
	handler, _ := buildAuthHandler()
	registerBody := bytes.NewBufferString(`{"username":"alice","password":"password123"}`)
	registerReq := httptest.NewRequest(http.MethodPost, "/api/auth/register", registerBody)
	registerRR := httptest.NewRecorder()
	handler.Register(registerRR, registerReq)
	if registerRR.Code != http.StatusOK {
		t.Fatalf("register status = %d, want %d", registerRR.Code, http.StatusOK)
	}
	registerPayload := decodeJSONBody(t, registerRR)
	refreshToken, _ := registerPayload["refresh_token"].(string)
	if refreshToken == "" {
		t.Fatalf("refresh token missing: %#v", registerPayload)
	}

	refreshReq := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", bytes.NewBufferString(`{"refresh_token":"`+refreshToken+`"}`))
	refreshRR := httptest.NewRecorder()
	handler.Refresh(refreshRR, refreshReq)
	if refreshRR.Code != http.StatusOK {
		t.Fatalf("refresh status = %d, want %d", refreshRR.Code, http.StatusOK)
	}
	refreshPayload := decodeJSONBody(t, refreshRR)
	if refreshPayload["access_token"] == "" || refreshPayload["refresh_token"] == "" {
		t.Fatalf("refresh token pair missing: %#v", refreshPayload)
	}
}

func TestMeRequiresAndUsesBearerToken(t *testing.T) {
	handler, cfg := buildAuthHandler()
	registerBody := bytes.NewBufferString(`{"username":"alice","password":"password123"}`)
	registerReq := httptest.NewRequest(http.MethodPost, "/api/auth/register", registerBody)
	registerRR := httptest.NewRecorder()
	handler.Register(registerRR, registerReq)
	registerPayload := decodeJSONBody(t, registerRR)
	accessToken, _ := registerPayload["access_token"].(string)
	if accessToken == "" {
		t.Fatalf("access token missing: %#v", registerPayload)
	}

	meHandler := middleware.Auth(cfg, handler.Me)
	meReq := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+accessToken)
	meRR := httptest.NewRecorder()
	meHandler.ServeHTTP(meRR, meReq)
	if meRR.Code != http.StatusOK {
		t.Fatalf("me status = %d, want %d", meRR.Code, http.StatusOK)
	}
}
