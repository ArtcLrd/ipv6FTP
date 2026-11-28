package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	apperr "ipv6ftp/internal/errors"
	"ipv6ftp/internal/transport/http/contracts"
)

type fakeLifeAPI struct {
	calls   []string
	err     error
	lastSID string
}

func (f *fakeLifeAPI) rec(s string) { f.calls = append(f.calls, s) }
func (f *fakeLifeAPI) Profile(_ context.Context, pid string) (contracts.ProfileResponse, error) {
	f.rec("profile:" + pid)
	return contracts.ProfileResponse{Username: "alice", Revision: 3, AccountState: "active"}, f.err
}
func (f *fakeLifeAPI) UsernameAvailable(_ context.Context, u string) (bool, error) {
	f.rec("avail:" + u)
	return u == "free_name", f.err
}
func (f *fakeLifeAPI) ChangeUsername(_ context.Context, pid, g, u string) error {
	f.rec("rename:" + pid + ":" + g + ":" + u)
	return f.err
}
func (f *fakeLifeAPI) RequestDeletion(_ context.Context, pid, g string) (time.Time, error) {
	f.rec("delete:" + pid + ":" + g)
	return time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC), f.err
}
func (f *fakeLifeAPI) DeletionStatusForCredentials(_ context.Context, u, p string) (contracts.DeletionStatusResponse, error) {
	f.rec("status:" + u)
	return contracts.DeletionStatusResponse{State: "active"}, f.err
}
func (f *fakeLifeAPI) CancelDeletion(_ context.Context, u, p string) error {
	f.rec("cancel:" + u)
	return f.err
}
func (f *fakeLifeAPI) ListSessions(_ context.Context, pid, sid string) (contracts.SessionsResponse, error) {
	f.rec("sessions:" + pid)
	f.lastSID = sid
	return contracts.SessionsResponse{Sessions: []contracts.SessionItem{}}, f.err
}
func (f *fakeLifeAPI) RevokeSession(_ context.Context, pid, sid string) error {
	f.rec("revoke:" + pid + ":" + sid)
	return f.err
}
func (f *fakeLifeAPI) RevokeAllSessions(_ context.Context, pid string) error {
	f.rec("logoutall:" + pid)
	return f.err
}

func get(h http.HandlerFunc, target, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	h(rr, req)
	return rr
}

const sessUUID = "11111111-2222-4333-8444-555555555555"

func TestLifecycleAuthenticatedRoutesNeedASessionAndUseItsPrincipal(t *testing.T) {
	api := &fakeLifeAPI{}
	h := NewAccountLifecycleHandler(api, quiet())
	pid := "9f1c2d3e-0000-4000-8000-000000000001"
	tok := accessToken(t, pid)

	for name, call := range map[string]func(token string) *httptest.ResponseRecorder{
		"profile":  func(tk string) *httptest.ResponseRecorder { return get(authed(h.Profile), "/x", tk) },
		"sessions": func(tk string) *httptest.ResponseRecorder { return get(authed(h.Sessions), "/x", tk) },
		"rename": func(tk string) *httptest.ResponseRecorder {
			return post(authed(h.ChangeUsername), `{"fresh_auth_grant":"g","username":"new_name"}`, tk)
		},
		"delete": func(tk string) *httptest.ResponseRecorder {
			return post(authed(h.RequestDeletion), `{"fresh_auth_grant":"g","confirm":true}`, tk)
		},
		"revoke": func(tk string) *httptest.ResponseRecorder {
			return post(authed(h.RevokeSession), `{"session_id":"`+sessUUID+`"}`, tk)
		},
		"logout-all": func(tk string) *httptest.ResponseRecorder { return post(authed(h.LogoutAll), `{}`, tk) },
	} {
		if rr := call(""); rr.Code != http.StatusUnauthorized {
			t.Errorf("%s without a token: %d", name, rr.Code)
		}
		if rr := call(tok); rr.Code >= 300 {
			t.Errorf("%s with a token: %d %s", name, rr.Code, rr.Body.String())
		}
	}
	want := []string{"profile:" + pid, "sessions:" + pid, "rename:" + pid + ":g:new_name", "delete:" + pid + ":g", "revoke:" + pid + ":" + sessUUID, "logoutall:" + pid}
	if len(api.calls) != len(want) {
		t.Fatalf("calls %v", api.calls)
	}
	seen := map[string]bool{}
	for _, c := range api.calls {
		seen[c] = true
	}
	for _, w := range want {
		if !seen[w] {
			t.Errorf("missing call %q in %v", w, api.calls)
		}
	}
	if api.lastSID != "sid" {
		t.Errorf("current session id not passed through: %q", api.lastSID)
	}
}

func TestLifecycleResponsesAreNoStoreAndShaped(t *testing.T) {
	h := NewAccountLifecycleHandler(&fakeLifeAPI{}, quiet())
	rr := post(authed(h.RequestDeletion), `{"fresh_auth_grant":"g","confirm":true}`, accessToken(t, "p"))
	if rr.Code != 200 || rr.Header().Get("Cache-Control") != "no-store" || !strings.Contains(rr.Body.String(), `"pending_deletion"`) || !strings.Contains(rr.Body.String(), "2026-11-08T12:00:00Z") {
		t.Fatalf("%d %v %s", rr.Code, rr.Header(), rr.Body.String())
	}
}

func TestUsernameAvailabilityIsPublicAndGetOnly(t *testing.T) {
	api := &fakeLifeAPI{}
	h := NewAccountLifecycleHandler(api, quiet())
	rr := get(h.UsernameAvailability, "/api/v2/usernames/availability?username=free_name", "")
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"available":true`) {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	if rr := post(h.UsernameAvailability, `{}`, ""); rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST accepted: %d", rr.Code)
	}
	api.err = apperr.NewCoded("bad", http.StatusBadRequest, contracts.CodeValidationFailed, nil)
	if rr := get(h.UsernameAvailability, "/x?username=x", ""); errorCode(t, rr) != contracts.CodeValidationFailed {
		t.Fatalf("validation error not mapped: %s", rr.Body.String())
	}
}

func TestDeletionStatusAndCancelArePublicButStrict(t *testing.T) {
	api := &fakeLifeAPI{}
	h := NewAccountLifecycleHandler(api, quiet())
	if rr := post(h.CancelDeletion, `{"username":"alice","password":"pw"}`, ""); rr.Code != http.StatusNoContent {
		t.Fatalf("cancel %d %s", rr.Code, rr.Body.String())
	}
	if rr := post(h.DeletionStatus, `{"username":"alice","password":"pw"}`, ""); rr.Code != 200 {
		t.Fatalf("status %d", rr.Code)
	}
	for _, body := range []string{`{"username":"alice"}`, `{"username":"alice","password":"pw","x":1}`, `{"username":"","password":"pw"}`} {
		if rr := post(h.CancelDeletion, body, ""); rr.Code != http.StatusBadRequest {
			t.Errorf("%s accepted: %d", body, rr.Code)
		}
	}
	if len(api.calls) != 2 {
		t.Fatalf("service reached for malformed input: %v", api.calls)
	}
}

func TestLifecycleMalformedAndForeignInputsNeverReachTheService(t *testing.T) {
	api := &fakeLifeAPI{}
	h := NewAccountLifecycleHandler(api, quiet())
	tok := accessToken(t, "p")
	for name, rr := range map[string]*httptest.ResponseRecorder{
		"rename bad grammar":     post(authed(h.ChangeUsername), `{"fresh_auth_grant":"g","username":"Bad Name"}`, tok),
		"delete without confirm": post(authed(h.RequestDeletion), `{"fresh_auth_grant":"g","confirm":false}`, tok),
		"revoke non uuid":        post(authed(h.RevokeSession), `{"session_id":"../../etc"}`, tok),
		"logout-all with body":   post(authed(h.LogoutAll), `{"all":true}`, tok),
		"profile via POST":       post(authed(h.Profile), `{}`, tok),
	} {
		if rr.Code < 400 {
			t.Errorf("%s: %d", name, rr.Code)
		}
	}
	if len(api.calls) != 0 {
		t.Fatalf("service called: %v", api.calls)
	}
}

func TestLifecycleServiceErrorsMapToContractCodesAndNeverLeakInternals(t *testing.T) {
	api := &fakeLifeAPI{err: apperr.NewCoded("Username unavailable", http.StatusConflict, contracts.CodeConflict, nil)}
	h := NewAccountLifecycleHandler(api, quiet())
	rr := post(authed(h.ChangeUsername), `{"fresh_auth_grant":"g","username":"new_name"}`, accessToken(t, "p"))
	if rr.Code != http.StatusConflict || errorCode(t, rr) != contracts.CodeConflict {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	api.err = context.DeadlineExceeded
	rr = get(authed(h.Profile), "/x", accessToken(t, "p"))
	if rr.Code != http.StatusServiceUnavailable || strings.Contains(rr.Body.String(), "deadline") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
}

func TestLifecycleFailsClosedWhenNotConfigured(t *testing.T) {
	h := NewAccountLifecycleHandler(nil, quiet())
	if rr := get(h.UsernameAvailability, "/x?username=abc", ""); rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("availability: %d", rr.Code)
	}
	if rr := post(h.CancelDeletion, `{"username":"a","password":"b"}`, ""); rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("cancel: %d", rr.Code)
	}
}
