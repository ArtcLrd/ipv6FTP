package httptransport

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ipv6ftp/internal/config"
)

func TestPublicProofLimitIgnoresForwardedAddress(t *testing.T) {
	calls := 0
	handler := limitPublicOperations(1, 5, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusNoContent)
	}))
	for _, forwarded := range []string{"192.0.2.1", "192.0.2.2"} {
		req := httptest.NewRequest(http.MethodPost, "/api/v2/auth/setup/resume", strings.NewReader(`{"username":"alice"}`))
		req.Header.Set("X-Forwarded-For", forwarded)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if forwarded == "192.0.2.2" && (res.Code != http.StatusTooManyRequests || res.Header().Get("Retry-After") == "") {
			t.Fatalf("expected rate limit, got %d", res.Code)
		}
	}
	if calls != 1 {
		t.Fatalf("proof handler called %d times", calls)
	}
}

func TestUpgradeRequiredDisablesV1Issuance(t *testing.T) {
	h := NewRouter(RouterDeps{
		Config: config.Config{V1CredentialIssuance: "upgrade_required"},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	for _, operation := range []string{"register", "login", "refresh"} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/api/v1/auth/"+operation, nil))
		if res.Code != http.StatusUpgradeRequired || !strings.Contains(res.Body.String(), `"upgrade_required"`) {
			t.Errorf("%s: %d %s", operation, res.Code, res.Body.String())
		}
	}
}

func testRouter() http.Handler {
	return NewRouter(RouterDeps{
		Config: config.Config{JWTSecret: "test-secret-test-secret-test-secret", RateLimitRPS: 1000, RateLimitBurst: 1000},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

func TestV2RecoveryRoutesFailClosedWhenNotConfigured(t *testing.T) {
	for _, path := range []string{"/api/v2/recovery/begin", "/api/v2/recovery/prove", "/api/v2/recovery/complete"} {
		body := map[string]string{
			"/api/v2/recovery/begin":    `{"method":"saved_code","identifier":"alice"}`,
			"/api/v2/recovery/prove":    `{"recovery_id":"` + strings.Repeat("r", 20) + `","code":"ABCD-EFGH-IJKL"}`,
			"/api/v2/recovery/complete": `{"recovery_grant":"g","new_password":"correct horse battery staple"}`,
		}[path]
		rr := httptest.NewRecorder()
		testRouter().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
		if rr.Code != http.StatusServiceUnavailable || !strings.Contains(rr.Body.String(), `"unavailable"`) {
			t.Errorf("%s: %d %s", path, rr.Code, rr.Body.String())
		}
	}
}

func TestV2AuthenticatedRoutesRequireASession(t *testing.T) {
	for _, path := range []string{
		"/api/v2/account/reauth", "/api/v2/account/password", "/api/v2/account/recovery-codes",
		"/api/v2/account/email/challenge", "/api/v2/account/email/verify", "/api/v2/auth/setup/ack-recovery-codes",
	} {
		rr := httptest.NewRecorder()
		testRouter().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`)))
		if rr.Code != http.StatusUnauthorized {
			t.Errorf("%s without a token: %d", path, rr.Code)
		}
	}
}

func TestV2LifecycleRoutes(t *testing.T) {
	// Public credentialed routes fail closed when account security is not configured.
	rr := httptest.NewRecorder()
	testRouter().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v2/usernames/availability?username=abc", nil))
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("availability: %d", rr.Code)
	}
	for _, path := range []string{"/api/v2/account/deletion/status", "/api/v2/account/deletion/cancel"} {
		rr := httptest.NewRecorder()
		testRouter().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"username":"alice","password":"pw"}`)))
		if rr.Code != http.StatusServiceUnavailable {
			t.Errorf("%s: %d", path, rr.Code)
		}
	}
	// Everything else needs a session.
	for method, paths := range map[string][]string{
		http.MethodGet:  {"/api/v2/account/profile", "/api/v2/account/sessions"},
		http.MethodPost: {"/api/v2/account/username", "/api/v2/account/deletion", "/api/v2/account/sessions/revoke", "/api/v2/auth/logout-all"},
	} {
		for _, path := range paths {
			rr := httptest.NewRecorder()
			testRouter().ServeHTTP(rr, httptest.NewRequest(method, path, strings.NewReader(`{}`)))
			if rr.Code != http.StatusUnauthorized {
				t.Errorf("%s %s without a token: %d", method, path, rr.Code)
			}
		}
	}
}

func TestV2AuthRoutes(t *testing.T) {
	// Public routes fail closed until NOISE_STATIC_KEY is configured.
	for _, c := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/v2/auth/registered/begin", `{"username":"alice_01","password":"correct horse battery staple","schema_version":2}`},
		{http.MethodPost, "/api/v2/auth/setup/resume", `{"username":"alice","password":"pw"}`},
		{http.MethodGet, "/api/v2/auth/server-key", ``},
		{http.MethodPost, "/api/v2/auth/enroll/challenge", `{"setup_grant":"g.s"}`},
		{http.MethodPost, "/api/v2/auth/refresh", `{"refresh_token":"0123456789abcdef0123"}`},
	} {
		rr := httptest.NewRecorder()
		testRouter().ServeHTTP(rr, httptest.NewRequest(c.method, c.path, strings.NewReader(c.body)))
		if rr.Code != http.StatusServiceUnavailable {
			t.Errorf("%s: %d", c.path, rr.Code)
		}
	}
	for method, paths := range map[string][]string{
		http.MethodGet:  {"/api/v2/auth/bootstrap"},
		http.MethodPost: {"/api/v2/auth/setup/activate", "/api/v2/auth/logout"},
	} {
		for _, path := range paths {
			rr := httptest.NewRecorder()
			testRouter().ServeHTTP(rr, httptest.NewRequest(method, path, strings.NewReader(`{}`)))
			if rr.Code != http.StatusUnauthorized {
				t.Errorf("%s without a token: %d", path, rr.Code)
			}
		}
	}
}
