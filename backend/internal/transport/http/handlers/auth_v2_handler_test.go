package handlers

import (
	"context"
	"net/http"
	"strings"
	"testing"

	apperr "ipv6ftp/internal/errors"
	"ipv6ftp/internal/transport/http/contracts"
)

type fakeAuthV2 struct {
	calls    []string
	err      error
	snapshot *contracts.BootstrapSnapshot
}

func (f *fakeAuthV2) rec(s string) { f.calls = append(f.calls, s) }
func (f *fakeAuthV2) BeginRegistered(_ context.Context, u, p string) (contracts.SetupGrantResponse, error) {
	f.rec("begin:" + u)
	return contracts.SetupGrantResponse{SetupGrant: "g.s", ExpiresInSeconds: 900}, f.err
}
func (f *fakeAuthV2) ResumeSetup(_ context.Context, u, p string) (contracts.SetupGrantResponse, error) {
	f.rec("resume:" + u)
	return contracts.SetupGrantResponse{SetupGrant: "g.s", ExpiresInSeconds: 900}, f.err
}
func (f *fakeAuthV2) ServerKey(rotation bool) contracts.ServerKeyResponse {
	f.rec("serverkey")
	return contracts.ServerKeyResponse{KeyID: "k1", PublicKey: "AAAA"}
}
func (f *fakeAuthV2) EnrollChallenge(_ context.Context, g string, rotation bool) (contracts.EnrollChallengeResponse, error) {
	f.rec("challenge:" + g)
	return contracts.EnrollChallengeResponse{ChallengeID: sessUUID, Nonce: "n", ExpiresInSeconds: 120, ServerKeyID: "k1"}, f.err
}
func (f *fakeAuthV2) EnrollFinish(_ context.Context, id, hs string) (contracts.EnrollFinishResponse, error) {
	f.rec("finish:" + id)
	return contracts.EnrollFinishResponse{Handshake: "h"}, f.err
}
func (f *fakeAuthV2) Activate(_ context.Context, pid, sid, did string, generation int, operationKey string) error {
	f.rec("activate:" + pid)
	return f.err
}
func (f *fakeAuthV2) Bootstrap(_ context.Context, pid, sid, did string) (contracts.BootstrapSnapshot, error) {
	f.rec("bootstrap:" + pid + ":" + sid + ":" + did)
	if f.snapshot != nil {
		return *f.snapshot, f.err
	}
	return contracts.BootstrapSnapshot{SchemaVersion: 2}, f.err
}

func TestBootstrapOptInCompatibility(t *testing.T) {
	cursor := "cursor"
	api := &fakeAuthV2{snapshot: &contracts.BootstrapSnapshot{SchemaVersion: 2, DeviceKeyFingerprint: "fingerprint", EventCursor: &cursor}}
	h := NewAuthV2Handler(api, quiet())
	token := accessToken(t, "9f1c2d3e-0000-4000-8000-000000000001")
	for _, tc := range []struct {
		query               string
		fingerprint, cursor bool
	}{
		{"", false, false}, {"?include=device_key_fingerprint", true, false},
		{"?snapshot=extended", false, true}, {"?snapshot=extended&include=device_key_fingerprint", true, true},
	} {
		rr := get(authed(h.Bootstrap), "/x"+tc.query, token)
		if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), `"device_key_fingerprint"`) != tc.fingerprint || strings.Contains(rr.Body.String(), `"event_cursor"`) != tc.cursor {
			t.Errorf("query %s: %d %s", tc.query, rr.Code, rr.Body.String())
		}
	}
}
func (f *fakeAuthV2) Refresh(_ context.Context, tok string) (contracts.RefreshResponse, error) {
	f.rec("refresh")
	return contracts.RefreshResponse{AccessToken: "a", RefreshToken: "r", ExpiresInSeconds: 900}, f.err
}
func (f *fakeAuthV2) Logout(_ context.Context, pid, sid string) error {
	f.rec("logout:" + pid + ":" + sid)
	return f.err
}

const goodHandshake = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

func TestAuthV2PublicRoutesDecodeStrictlyAndSetNoStore(t *testing.T) {
	api := &fakeAuthV2{}
	h := NewAuthV2Handler(api, quiet())
	ok := map[string]*struct {
		fn   http.HandlerFunc
		body string
	}{
		"begin":     {h.RegisteredBegin, `{"username":"alice_01","password":"correct horse battery staple","schema_version":2}`},
		"resume":    {h.SetupResume, `{"username":"alice","password":"pw"}`},
		"challenge": {h.EnrollChallenge, `{"setup_grant":"g.s"}`},
		"finish":    {h.EnrollFinish, `{"challenge_id":"` + sessUUID + `","handshake":"` + goodHandshake + `"}`},
		"refresh":   {h.Refresh, `{"refresh_token":"0123456789abcdef0123"}`},
	}
	for name, c := range ok {
		rr := post(c.fn, c.body, "")
		if rr.Code != 200 || rr.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s: %d %v %s", name, rr.Code, rr.Header(), rr.Body.String())
		}
	}
	if len(api.calls) != 5 {
		t.Fatalf("calls %v", api.calls)
	}
	// Unknown fields, trailing data and wrong shapes never reach the service.
	api.calls = nil
	for name, c := range map[string]struct {
		fn   http.HandlerFunc
		body string
	}{
		"begin wrong schema": {h.RegisteredBegin, `{"username":"alice_01","password":"correct horse battery staple","schema_version":1}`},
		"begin extra field":  {h.RegisteredBegin, `{"username":"alice_01","password":"correct horse battery staple","schema_version":2,"admin":true}`},
		"begin bad username": {h.RegisteredBegin, `{"username":"A","password":"correct horse battery staple","schema_version":2}`},
		"challenge empty":    {h.EnrollChallenge, `{"setup_grant":""}`},
		"finish short":       {h.EnrollFinish, `{"challenge_id":"` + sessUUID + `","handshake":"AAAA"}`},
		"finish bad id":      {h.EnrollFinish, `{"challenge_id":"x","handshake":"` + goodHandshake + `"}`},
		"refresh short":      {h.Refresh, `{"refresh_token":"abc"}`},
		"refresh trailing":   {h.Refresh, `{"refresh_token":"0123456789abcdef0123"} {}`},
	} {
		if rr := post(c.fn, c.body, ""); rr.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", name, rr.Code)
		}
	}
	if len(api.calls) != 0 {
		t.Fatalf("service reached for malformed input: %v", api.calls)
	}
}

func TestAuthV2WeakPasswordMessageIsActionable(t *testing.T) {
	h := NewAuthV2Handler(&fakeAuthV2{}, quiet())
	rr := post(h.RegisteredBegin, `{"username":"alice_01","password":"short","schema_version":2}`, "")
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "Password") && !strings.Contains(strings.ToLower(rr.Body.String()), "password") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
}

func TestAuthV2AuthenticatedRoutesNeedASessionAndPassClaims(t *testing.T) {
	api := &fakeAuthV2{}
	h := NewAuthV2Handler(api, quiet())
	pid := "9f1c2d3e-0000-4000-8000-000000000001"
	tok := accessToken(t, pid)
	for name, call := range map[string]func(string) int{
		"activate":  func(tk string) int { return post(authed(h.Activate), `{}`, tk).Code },
		"logout":    func(tk string) int { return post(authed(h.Logout), `{}`, tk).Code },
		"bootstrap": func(tk string) int { return get(authed(h.Bootstrap), "/x", tk).Code },
	} {
		if code := call(""); code != http.StatusUnauthorized {
			t.Errorf("%s without a token: %d", name, code)
		}
		if code := call(tok); code >= 300 {
			t.Errorf("%s with a token: %d", name, code)
		}
	}
	want := map[string]bool{"activate:" + pid: true, "logout:" + pid + ":sid": true, "bootstrap:" + pid + ":sid:did": true}
	for _, c := range api.calls {
		if !want[c] {
			t.Errorf("unexpected call %q", c)
		}
		delete(want, c)
	}
	if len(want) != 0 {
		t.Errorf("missing calls %v", want)
	}
	if rr := post(authed(h.Logout), `{"all":true}`, tok); rr.Code != http.StatusBadRequest {
		t.Errorf("logout with a body: %d", rr.Code)
	}
	if rr := post(authed(h.Bootstrap), `{}`, tok); rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("bootstrap via POST: %d", rr.Code)
	}
}

func TestAuthV2ServerKeyIsPublicGetOnly(t *testing.T) {
	h := NewAuthV2Handler(&fakeAuthV2{}, quiet())
	if rr := get(h.ServerKey, "/x", ""); rr.Code != 200 || !strings.Contains(rr.Body.String(), `"key_id":"k1"`) {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	if rr := post(h.ServerKey, `{}`, ""); rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST: %d", rr.Code)
	}
}

func TestAuthV2ErrorsMapAndInternalsStayHidden(t *testing.T) {
	api := &fakeAuthV2{err: apperr.NewCoded("Enrollment failed", http.StatusForbidden, contracts.CodeForbidden, nil)}
	h := NewAuthV2Handler(api, quiet())
	rr := post(h.EnrollFinish, `{"challenge_id":"`+sessUUID+`","handshake":"`+goodHandshake+`"}`, "")
	if rr.Code != http.StatusForbidden || errorCode(t, rr) != contracts.CodeForbidden {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	api.err = context.DeadlineExceeded
	rr = post(h.Refresh, `{"refresh_token":"0123456789abcdef0123"}`, "")
	if rr.Code != http.StatusServiceUnavailable || strings.Contains(rr.Body.String(), "deadline") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
}

func TestAuthV2FailsClosedWhenNotConfigured(t *testing.T) {
	h := NewAuthV2Handler(nil, quiet())
	if rr := post(h.RegisteredBegin, `{"username":"alice_01","password":"correct horse battery staple","schema_version":2}`, ""); rr.Code != http.StatusServiceUnavailable {
		t.Errorf("begin: %d", rr.Code)
	}
	if rr := get(h.ServerKey, "/x", ""); rr.Code != http.StatusServiceUnavailable {
		t.Errorf("server key: %d", rr.Code)
	}
	if rr := get(authed(h.Bootstrap), "/x", accessToken(t, "p")); rr.Code != http.StatusServiceUnavailable {
		t.Errorf("bootstrap: %d", rr.Code)
	}
}
