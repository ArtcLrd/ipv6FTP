package contracts

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fixtureDir = "../../../../testdata/contracts/v2"

func newByName(name string) any {
	switch name {
	case "ErrorEnvelope":
		return &ErrorEnvelope{}
	case "FreshAuthRequest":
		return &FreshAuthRequest{}
	case "PasswordChangeRequest":
		return &PasswordChangeRequest{}
	case "RecoveryBeginRequest":
		return &RecoveryBeginRequest{}
	case "RecoveryProveRequest":
		return &RecoveryProveRequest{}
	case "RecoveryCompleteRequest":
		return &RecoveryCompleteRequest{}
	case "EmailChallengeRequest":
		return &EmailChallengeRequest{}
	case "EmailVerifyRequest":
		return &EmailVerifyRequest{}
	case "UsernameChangeRequest":
		return &UsernameChangeRequest{}
	case "DeletionRequest":
		return &DeletionRequest{}
	case "RecoveryCodesRequest":
		return &RecoveryCodesRequest{}
	case "EmptyRequest":
		return &EmptyRequest{}
	case "RecoveryAckRequest":
		return &RecoveryAckRequest{}
	case "BootstrapSnapshot":
		return &BootstrapSnapshot{}
	case "RecoveryBeginResponse":
		return &RecoveryBeginResponse{}
	case "RecoveryProveResponse":
		return &RecoveryProveResponse{}
	case "RecoveryCompleteResponse":
		return &RecoveryCompleteResponse{}
	case "RecoveryCodesResponse":
		return &RecoveryCodesResponse{}
	case "FreshAuthResponse":
		return &FreshAuthResponse{}
	case "EmailChallengeResponse":
		return &EmailChallengeResponse{}
	case "RegisteredBeginRequest":
		return &RegisteredBeginRequest{}
	case "SetupResumeRequest":
		return &SetupResumeRequest{}
	case "SetupGrantResponse":
		return &SetupGrantResponse{}
	case "EnrollChallengeRequest":
		return &EnrollChallengeRequest{}
	case "EnrollChallengeResponse":
		return &EnrollChallengeResponse{}
	case "EnrollFinishRequest":
		return &EnrollFinishRequest{}
	case "EnrollFinishResponse":
		return &EnrollFinishResponse{}
	case "SessionGrant":
		return &SessionGrant{}
	case "ServerKeyResponse":
		return &ServerKeyResponse{}
	case "RefreshRequest":
		return &RefreshRequest{}
	case "RefreshResponse":
		return &RefreshResponse{}
	}
	return nil
}

func fixtures(t *testing.T, kind string) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(fixtureDir, kind, "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no %s fixtures: %v", kind, err)
	}
	return files
}

func TestValidFixturesDecode(t *testing.T) {
	for _, f := range fixtures(t, "valid") {
		name := strings.SplitN(strings.TrimSuffix(filepath.Base(f), ".json"), ".", 2)[0]
		dst := newByName(name)
		if dst == nil {
			t.Fatalf("%s: unknown contract type", name)
		}
		raw, _ := os.ReadFile(f)
		if err := DecodeBytes(raw, dst); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestInvalidFixturesRejected(t *testing.T) {
	for _, f := range fixtures(t, "invalid") {
		base := strings.TrimSuffix(filepath.Base(f), ".json")
		name := strings.SplitN(base, ".", 2)[0]
		dst := newByName(name)
		if dst == nil {
			t.Fatalf("%s: unknown contract type", base)
		}
		raw, _ := os.ReadFile(f)
		if err := DecodeBytes(raw, dst); err == nil {
			t.Errorf("%s: accepted", base)
		}
	}
}

func TestDecodeLimitsAndMethod(t *testing.T) {
	big := `{"fresh_auth_grant":"` + strings.Repeat("a", MaxBodyBytes) + `","confirm":true}`
	if err := DecodeBytes([]byte(big), &DeletionRequest{}); err != ErrBodyTooLarge {
		t.Fatalf("oversize: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/x", strings.NewReader(`{}`))
	if err := Decode(req, http.MethodPost, &DeletionRequest{}); err != ErrMethodNotAllow {
		t.Fatalf("method: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"fresh_auth_grant":"g","confirm":true}`))
	if err := Decode(req, http.MethodPost, &DeletionRequest{}); err != nil {
		t.Fatalf("valid post: %v", err)
	}
}

func TestErrorStatusMapping(t *testing.T) {
	want := map[string]int{CodeAccessExpired: 401, CodeRateLimited: 429, CodeUpgradeRequired: 426, CodeUnavailable: 503, CodeNotFound: 404}
	for code, status := range want {
		if StatusFor(code) != status {
			t.Errorf("%s -> %d", code, StatusFor(code))
		}
	}
	if StatusFor("made_up") != 500 {
		t.Fatal("unknown code must map to 500")
	}
}
