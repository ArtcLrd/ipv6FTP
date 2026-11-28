package bootstrap

import (
	"testing"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/repository"
)

const goodKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" // base64 of 32 bytes

func TestAccountSecurityDisabledReturnsUntypedNil(t *testing.T) {
	api, err := buildAccountSecurity(config.Config{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	// A typed nil pointer inside the interface would make this comparison false
	// and the handler would panic instead of answering "unavailable".
	if api != nil {
		t.Fatalf("want untyped nil interface, got %#v", api)
	}
}

func TestAccountSecurityEnabledWithValidSecrets(t *testing.T) {
	api, err := buildAccountSecurity(config.Config{RecoveryPepper: "0123456789abcdef0123", EmailPayloadKey: goodKey, EmailPayloadKeyVersion: 1}, nil)
	if err != nil || api == nil {
		t.Fatalf("%v %v", api, err)
	}
}

func TestAccountSecurityRejectsBadSecrets(t *testing.T) {
	for name, cfg := range map[string]config.Config{
		"short pepper": {RecoveryPepper: "short", EmailPayloadKey: goodKey},
		"bad base64":   {RecoveryPepper: "0123456789abcdef0123", EmailPayloadKey: "!!!"},
		"short key":    {RecoveryPepper: "0123456789abcdef0123", EmailPayloadKey: "c2hvcnQ="},
	} {
		if api, err := buildAccountSecurity(cfg, nil); err == nil || api != nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestAccountLifecycleFollowsAccountSecurity(t *testing.T) {
	api, err := buildAccountLifecycle(nil, nil)
	if err != nil || api != nil {
		t.Fatalf("expected untyped nil when account security is off, got %#v %v", api, err)
	}
	sec, err := buildAccountSecurity(config.Config{RecoveryPepper: "0123456789abcdef0123", EmailPayloadKey: goodKey, EmailPayloadKeyVersion: 1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	api, err = buildAccountLifecycle(sec, nil)
	if err != nil || api == nil {
		t.Fatalf("expected a service, got %#v %v", api, err)
	}
}

func TestAuthV2DisabledWithoutNoiseKey(t *testing.T) {
	api, err := buildAuthV2(config.Config{}, nil, nil)
	if err != nil || api != nil {
		t.Fatalf("expected untyped nil, got %#v %v", api, err)
	}
}

func TestAuthV2RejectsBadKeyAndBuildsWithGoodOne(t *testing.T) {
	cfg := config.Config{RecoveryPepper: "0123456789abcdef0123", JWTSecret: "jwt-secret", NoiseKeyID: "k1"}
	for _, bad := range []string{"!!!", "c2hvcnQ="} {
		cfg.NoiseStaticKey = bad
		if api, err := buildAuthV2(cfg, nil, &repository.PgIdentityRepo{}); err == nil || api != nil {
			t.Errorf("accepted %q", bad)
		}
	}
	cfg.NoiseStaticKey = goodKey
	api, err := buildAuthV2(cfg, nil, &repository.PgIdentityRepo{})
	if err != nil || api == nil {
		t.Fatalf("good key: %v", err)
	}
	if k := api.ServerKey(false); k.KeyID != "k1" || len(k.PublicKey) == 0 {
		t.Fatalf("%+v", k)
	}
}
