package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/security"
)

type testSessionValidator struct{ err error }

func (v testSessionValidator) ValidateSession(context.Context, string, string, string, int) error {
	return v.err
}

type testSetupValidator struct{}

func (testSetupValidator) ValidateSession(context.Context, string, string, string, int) error {
	return repository.ErrSetupRestricted
}

func (testSetupValidator) ValidateSessionState(context.Context, string, string, string, int) (bool, error) {
	return true, nil
}

func TestSetupSessionRequiresExplicitRoutePermission(t *testing.T) {
	cfg := config.Config{JWTSecret: "test-session-secret"}
	token, err := security.IssueSessionAccessToken([]byte(cfg.JWTSecret), "p", "s", "d", "alice", "app_user", "registered", "", 2)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	next := func(w http.ResponseWriter, r *http.Request) {
		if !IsSetupSession(r.Context()) {
			t.Fatal("handler did not receive setup scope")
		}
		w.WriteHeader(http.StatusNoContent)
	}
	blocked := httptest.NewRecorder()
	AuthWithSession(cfg, testSetupValidator{}, next)(blocked, req)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("ordinary route returned %d", blocked.Code)
	}
	allowed := httptest.NewRecorder()
	AuthWithSetupSession(cfg, testSetupValidator{}, next)(allowed, req)
	if allowed.Code != http.StatusNoContent {
		t.Fatalf("setup route returned %d", allowed.Code)
	}
}

func TestAuthWithSessionClassifiesValidationErrors(t *testing.T) {
	cfg := config.Config{JWTSecret: "secret"}
	token, err := security.IssueSessionAccessToken([]byte(cfg.JWTSecret), "user", "session", "device", "alice", "user", "registered", "free", 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"invalid", pgx.ErrNoRows, http.StatusUnauthorized, "SESSION_INVALID"},
		{"unavailable", errors.New("database unavailable"), http.StatusServiceUnavailable, "AUTH_UNAVAILABLE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := AuthWithSession(cfg, testSessionValidator{tc.err}, func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected authorization") })
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			h.ServeHTTP(response, req)
			var body map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != tc.status || body["code"] != tc.code {
				t.Fatalf("got %d %q", response.Code, body["code"])
			}
		})
	}
}

func TestSessionAuthenticationFailsClosedWithoutValidator(t *testing.T) {
	cfg := config.Config{JWTSecret: "test-session-secret"}
	token, err := security.IssueSessionAccessToken([]byte(cfg.JWTSecret), "p", "s", "d", "alice", "app_user", "registered", "", 2)
	if err != nil {
		t.Fatal(err)
	}
	for _, wrap := range []func(config.Config, SessionValidator, http.HandlerFunc) http.HandlerFunc{AuthWithSession, AuthWithSetupSession} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		wrap(cfg, nil, func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected authorization") })(response, req)
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("got status %d", response.Code)
		}
	}
}

func TestTokenErrorDoesNotRefreshOtherInvalidCredentials(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		{"expired", jwt.ErrTokenExpired, "ACCESS_EXPIRED"},
		{"expired with wrong issuer", errors.Join(jwt.ErrTokenExpired, jwt.ErrTokenInvalidIssuer), "SESSION_INVALID"},
		{"expired with invalid signature", errors.Join(jwt.ErrTokenExpired, jwt.ErrTokenSignatureInvalid), "SESSION_INVALID"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			tokenError(response, tc.err)
			var body map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["code"] != tc.code {
				t.Fatalf("code = %q, want %q", body["code"], tc.code)
			}
		})
	}
}

func TestExpiredTokenMustBeValidAccessTypeToTriggerRefresh(t *testing.T) {
	for _, tc := range []struct {
		name      string
		tokenType string
		issuer    string
		secret    string
		wantCode  string
	}{
		{"expired access", "access", "ipv6ftp-api", "secret", "ACCESS_EXPIRED"},
		{"expired refresh", "refresh", "ipv6ftp-api", "secret", "SESSION_INVALID"},
		{"wrong issuer", "access", "wrong", "secret", "SESSION_INVALID"},
		{"bad signature", "access", "ipv6ftp-api", "wrong", "SESSION_INVALID"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			claims := security.TokenClaims{TokenType: tc.tokenType, RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)), Issuer: tc.issuer, Audience: jwt.ClaimStrings{"ipv6ftp-native"},
			}}
			token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(tc.secret))
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			AuthWithSession(config.Config{JWTSecret: "secret"}, nil, func(http.ResponseWriter, *http.Request) { t.Fatal("unexpected authorization") })(response, req)
			var body map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusUnauthorized || body["code"] != tc.wantCode {
				t.Fatalf("got %d %q, want %q", response.Code, body["code"], tc.wantCode)
			}
		})
	}
}

func TestAuthUsesBearerHeader(t *testing.T) {
	cfg := config.Config{JWTSecret: "secret"}
	access, _, err := security.IssueTokenPair([]byte(cfg.JWTSecret), "u1", "alice", "user")
	if err != nil {
		t.Fatalf("IssueTokenPair() error = %v", err)
	}

	okHandler := Auth(cfg, func(w http.ResponseWriter, r *http.Request) {
		if claims := ClaimsFromContext(r.Context()); claims == nil || claims.Sub != "u1" {
			t.Fatalf("claims missing or wrong: %#v", claims)
		}
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+access)
	rr := httptest.NewRecorder()
	okHandler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
}

func TestAuthRejectsMissingBearer(t *testing.T) {
	cfg := config.Config{JWTSecret: "secret"}
	h := Auth(cfg, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestLockdownAllowsAdminViaBearerToken(t *testing.T) {
	cfg := config.Config{JWTSecret: "secret"}
	cache := repository.NewMemoryCacheRepo()
	if err := cache.SetBool(context.Background(), "ipv6ftp:lockdown", true); err != nil {
		t.Fatalf("SetBool() error = %v", err)
	}
	access, _, err := security.IssueTokenPair([]byte(cfg.JWTSecret), "admin-id", "root", "admin")
	if err != nil {
		t.Fatalf("IssueTokenPair() error = %v", err)
	}

	h := Lockdown(cfg, cache, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/lockdown", nil)
	req.Header.Set("Authorization", "Bearer "+access)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNoContent)
	}
}
