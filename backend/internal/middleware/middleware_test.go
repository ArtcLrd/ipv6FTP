package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/security"
)

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
