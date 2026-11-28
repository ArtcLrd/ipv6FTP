package handlers

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ipv6ftp/internal/config"
	apperr "ipv6ftp/internal/errors"
	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/security"
	"ipv6ftp/internal/transport/http/contracts"
)

type fakeAccountAPI struct {
	calls     []string
	principal string
	freshErr  error
	err       error
}

func (f *fakeAccountAPI) rec(name string) { f.calls = append(f.calls, name) }
func (f *fakeAccountAPI) BeginRecovery(_ context.Context, m, id string) (string, error) {
	f.rec("begin:" + m + ":" + id)
	return strings.Repeat("r", 20), f.err
}
func (f *fakeAccountAPI) ProveRecovery(_ context.Context, id, code string) (string, error) {
	f.rec("prove")
	return "grant-token", f.err
}
func (f *fakeAccountAPI) CompleteRecovery(_ context.Context, g, pw string) ([]string, error) {
	f.rec("complete")
	return codes10(), f.err
}
func (f *fakeAccountAPI) IssueFreshAuth(_ context.Context, pid, pw, op string) (string, int, error) {
	f.principal = pid
	f.rec("reauth:" + op)
	return "fresh-grant", 300, f.err
}
func (f *fakeAccountAPI) RequireFreshAuth(_ context.Context, pid, g, op string) error {
	f.principal = pid
	f.rec("require:" + op)
	return f.freshErr
}
func (f *fakeAccountAPI) ChangePassword(ctx context.Context, pid, grant, pw string) error {
	if err := f.RequireFreshAuth(ctx, pid, grant, "password_change"); err != nil {
		return err
	}
	f.rec("change_password")
	return f.err
}
func (f *fakeAccountAPI) RegenerateRecoveryCodes(ctx context.Context, pid, grant string) ([]string, error) {
	if err := f.RequireFreshAuth(ctx, pid, grant, "recovery_codes"); err != nil {
		return nil, err
	}
	f.rec("issue_codes")
	return codes10(), f.err
}
func (f *fakeAccountAPI) AcknowledgeRecoveryCodes(_ context.Context, pid, code string) error {
	f.principal = pid
	f.rec("ack")
	return f.err
}
func (f *fakeAccountAPI) StartEmailVerification(_ context.Context, pid, email string) (string, error) {
	f.rec("email_start")
	return "123e4567-e89b-12d3-a456-426614174000", f.err
}
func (f *fakeAccountAPI) VerifyEmail(_ context.Context, pid, id, code string) error {
	f.rec("email_verify")
	return f.err
}

func codes10() []string {
	out := make([]string, 10)
	for i := range out {
		out[i] = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ0" + string(rune('0'+i))
	}
	return out
}

var testCfg = config.Config{JWTSecret: "test-secret-test-secret-test-secret"}

func accessToken(t *testing.T, pid string) string {
	t.Helper()
	tok, err := security.IssueSessionAccessToken([]byte(testCfg.JWTSecret), pid, "sid", "did", "alice", "app_user", "registered", "", 1)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

type validTestSession struct{}

func (validTestSession) ValidateSession(context.Context, string, string, string, int) error {
	return nil
}

func authed(h http.HandlerFunc) http.HandlerFunc {
	return middleware.AuthWithSession(testCfg, validTestSession{}, h)
}

func post(h http.HandlerFunc, body string, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	h(rr, req)
	return rr
}

func errorCode(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	var env contracts.ErrorEnvelope
	if err := contracts.DecodeBytes(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("not a v2 error envelope: %v body=%s", err, rr.Body.String())
	}
	return env.Error.Code
}

func TestRecoveryEndpointsReturnContractShapesAndNoStore(t *testing.T) {
	api := &fakeAccountAPI{}
	h := NewAccountSecurityHandler(api, quiet())

	rr := post(h.RecoveryBegin, `{"method":"saved_code","identifier":"alice"}`, "")
	var begin contracts.RecoveryBeginResponse
	if rr.Code != 200 || contracts.DecodeBytes(rr.Body.Bytes(), &begin) != nil {
		t.Fatalf("begin: %d %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("responses carrying credentials must not be cacheable")
	}

	rr = post(h.RecoveryProve, `{"recovery_id":"`+begin.RecoveryID+`","code":"ABCD-EFGH-IJKL"}`, "")
	var prove contracts.RecoveryProveResponse
	if rr.Code != 200 || contracts.DecodeBytes(rr.Body.Bytes(), &prove) != nil {
		t.Fatalf("prove: %d %s", rr.Code, rr.Body.String())
	}

	rr = post(h.RecoveryComplete, `{"recovery_grant":"grant-token","new_password":"correct horse battery staple"}`, "")
	var done contracts.RecoveryCompleteResponse
	if rr.Code != 200 || contracts.DecodeBytes(rr.Body.Bytes(), &done) != nil {
		t.Fatalf("complete: %d %s", rr.Code, rr.Body.String())
	}
}

func TestMalformedRequestsAreRejectedBeforeTheService(t *testing.T) {
	api := &fakeAccountAPI{}
	h := NewAccountSecurityHandler(api, quiet())
	cases := map[string]string{
		"unknown field": `{"method":"saved_code","identifier":"alice","admin":true}`,
		"trailing data": `{"method":"saved_code","identifier":"alice"}{"x":1}`,
		"bad method":    `{"method":"sms","identifier":"alice"}`,
		"not json":      `nope`,
	}
	for name, body := range cases {
		rr := post(h.RecoveryBegin, body, "")
		if rr.Code != 400 || errorCode(t, rr) != "validation_failed" {
			t.Errorf("%s: %d %s", name, rr.Code, rr.Body.String())
		}
	}
	big := `{"method":"saved_code","identifier":"` + strings.Repeat("a", contracts.MaxBodyBytes) + `"}`
	if rr := post(h.RecoveryBegin, big, ""); rr.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversize: %d", rr.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rr := httptest.NewRecorder()
	h.RecoveryBegin(rr, req)
	if rr.Code != http.StatusMethodNotAllowed || rr.Header().Get("Allow") != "POST" {
		t.Errorf("method: %d", rr.Code)
	}
	if len(api.calls) != 0 {
		t.Fatalf("service reached with invalid input: %v", api.calls)
	}
}

func TestUnconfiguredFeatureFailsClosed(t *testing.T) {
	h := NewAccountSecurityHandler(nil, quiet())
	rr := post(h.RecoveryBegin, `{"method":"saved_code","identifier":"alice"}`, "")
	if rr.Code != 503 || errorCode(t, rr) != "unavailable" {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	rr = post(authed(h.Reauth), `{"password":"pw","operation":"password_change"}`, accessToken(t, "p1"))
	if rr.Code != 503 {
		t.Fatalf("authenticated route when unconfigured: %d", rr.Code)
	}
}

func TestServiceErrorsMapToContractCodes(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{apperr.NewCoded("slow", 429, contracts.CodeRateLimited, nil), 429, "rate_limited"},
		{apperr.NewCoded("no", 403, contracts.CodeForbidden, nil), 403, "forbidden"},
		{apperr.NewCoded("conflict", 409, contracts.CodeConflict, nil), 409, "conflict"},
		{errors.New("pq: password=hunter2 connection refused"), 503, "unavailable"},
	}
	for _, c := range cases {
		h := NewAccountSecurityHandler(&fakeAccountAPI{err: c.err}, quiet())
		rr := post(h.RecoveryProve, `{"recovery_id":"`+strings.Repeat("r", 20)+`","code":"ABCD-EFGH-IJKL"}`, "")
		if rr.Code != c.status || errorCode(t, rr) != c.code {
			t.Errorf("%v: %d %s", c.err, rr.Code, rr.Body.String())
		}
		if strings.Contains(rr.Body.String(), "hunter2") {
			t.Fatal("internal error text leaked to the client")
		}
	}
}

func TestAuthenticatedRoutesRequireASession(t *testing.T) {
	api := &fakeAccountAPI{}
	h := NewAccountSecurityHandler(api, quiet())
	routes := map[string]http.HandlerFunc{
		"reauth":   h.Reauth,
		"password": h.ChangePassword,
		"codes":    h.RegenerateRecoveryCodes,
		"ack":      h.AckRecoveryCodes,
		"email":    h.EmailChallenge,
		"verify":   h.EmailVerify,
	}
	for name, fn := range routes {
		if rr := post(authed(fn), `{}`, ""); rr.Code != 401 {
			t.Errorf("%s without a token: %d", name, rr.Code)
		}
	}
	if len(api.calls) != 0 {
		t.Fatalf("service reached without authentication: %v", api.calls)
	}
}

func TestAuthenticatedHandlersUseThePrincipalFromTheToken(t *testing.T) {
	api := &fakeAccountAPI{}
	h := NewAccountSecurityHandler(api, quiet())
	tok := accessToken(t, "principal-42")

	rr := post(authed(h.AckRecoveryCodes), `{"code":"AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA"}`, tok)
	if rr.Code != http.StatusNoContent || api.principal != "principal-42" {
		t.Fatalf("ack: %d principal=%q", rr.Code, api.principal)
	}

	rr = post(authed(h.Reauth), `{"password":"hunter2 hunter2 hunter2","operation":"password_change"}`, tok)
	var fresh contracts.FreshAuthResponse
	if rr.Code != 200 || contracts.DecodeBytes(rr.Body.Bytes(), &fresh) != nil || api.principal != "principal-42" {
		t.Fatalf("reauth: %d %s", rr.Code, rr.Body.String())
	}
}

func TestSensitiveOperationsRequireTheirOwnFreshAuthGrant(t *testing.T) {
	tok := accessToken(t, "p1")
	denied := apperr.NewCoded("Fresh authentication required", 403, contracts.CodeForbidden, nil)

	cases := []struct {
		name string
		fn   func(*AccountSecurityHandler) http.HandlerFunc
		body string
		op   string
		act  string
	}{
		{"password", func(h *AccountSecurityHandler) http.HandlerFunc { return h.ChangePassword },
			`{"fresh_auth_grant":"g","new_password":"correct horse battery staple"}`, "password_change", "change_password"},
		{"codes", func(h *AccountSecurityHandler) http.HandlerFunc { return h.RegenerateRecoveryCodes },
			`{"fresh_auth_grant":"g"}`, "recovery_codes", "issue_codes"},
		{"email", func(h *AccountSecurityHandler) http.HandlerFunc { return h.EmailChallenge },
			`{"fresh_auth_grant":"g","email":"alice@example.com"}`, "email_change", "email_start"},
	}
	for _, c := range cases {
		api := &fakeAccountAPI{freshErr: denied}
		rr := post(authed(c.fn(NewAccountSecurityHandler(api, quiet()))), c.body, tok)
		if rr.Code != 403 || errorCode(t, rr) != "forbidden" {
			t.Errorf("%s denied: %d %s", c.name, rr.Code, rr.Body.String())
		}
		for _, call := range api.calls {
			if call == c.act {
				t.Errorf("%s performed the action without a valid grant", c.name)
			}
		}
		if len(api.calls) != 1 || api.calls[0] != "require:"+c.op {
			t.Errorf("%s: wrong operation bound to grant: %v", c.name, api.calls)
		}

		api = &fakeAccountAPI{}
		rr = post(authed(c.fn(NewAccountSecurityHandler(api, quiet()))), c.body, tok)
		if rr.Code != 200 && rr.Code != 204 {
			t.Errorf("%s allowed: %d %s", c.name, rr.Code, rr.Body.String())
		}
		if api.calls[len(api.calls)-1] != c.act {
			t.Errorf("%s: action not performed after a valid grant: %v", c.name, api.calls)
		}
	}
}

func TestWeakPasswordIsRejectedWithActionableMessage(t *testing.T) {
	api := &fakeAccountAPI{}
	h := NewAccountSecurityHandler(api, quiet())
	rr := post(authed(h.ChangePassword), `{"fresh_auth_grant":"g","new_password":"short"}`, accessToken(t, "p1"))
	if rr.Code != 400 || !strings.Contains(rr.Body.String(), "15-128") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	if len(api.calls) != 0 {
		t.Fatalf("service reached with a weak password: %v", api.calls)
	}
}

func TestRegeneratedCodesMatchTheContract(t *testing.T) {
	h := NewAccountSecurityHandler(&fakeAccountAPI{}, quiet())
	rr := post(authed(h.RegenerateRecoveryCodes), `{"fresh_auth_grant":"g"}`, accessToken(t, "p1"))
	var resp contracts.RecoveryCodesResponse
	if rr.Code != 200 || contracts.DecodeBytes(rr.Body.Bytes(), &resp) != nil || len(resp.RecoveryCodes) != 10 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
}
