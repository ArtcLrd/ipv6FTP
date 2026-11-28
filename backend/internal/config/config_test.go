package config

import "testing"

func TestLoadPrefersDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://primary")
	t.Setenv("SUPABASE_DB_URL", "postgres://fallback")
	t.Setenv("POSTGRES_URL", "postgres://legacy")
	t.Setenv("JWT_SECRET", "test-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DatabaseURL != "postgres://primary" {
		t.Fatalf("DatabaseURL = %q, want %q", cfg.DatabaseURL, "postgres://primary")
	}
}

func TestLoadRedisConfig(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://primary")
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("REDIS_URL", "127.0.0.1:6379")
	t.Setenv("REDIS_PASSWORD", "pw")
	t.Setenv("REDIS_DB", "2")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.RedisURL != "127.0.0.1:6379" {
		t.Fatalf("RedisURL = %q", cfg.RedisURL)
	}
	if cfg.RedisPassword != "pw" {
		t.Fatalf("RedisPassword = %q", cfg.RedisPassword)
	}
	if cfg.RedisDB != 2 {
		t.Fatalf("RedisDB = %d, want 2", cfg.RedisDB)
	}
}

func baseEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://primary")
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("RECOVERY_PEPPER", "")
	t.Setenv("EMAIL_PAYLOAD_KEY", "")
}

func TestAccountSecuritySecretsOptionalButAllOrNothing(t *testing.T) {
	good := "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" // base64 of 32 bytes

	baseEnv(t)
	if _, err := Load(); err != nil {
		t.Fatalf("both unset must load: %v", err)
	}

	baseEnv(t)
	t.Setenv("RECOVERY_PEPPER", "0123456789abcdef0123")
	t.Setenv("EMAIL_PAYLOAD_KEY", good)
	cfg, err := Load()
	if err != nil || cfg.EmailPayloadKeyVersion != 1 {
		t.Fatalf("both set must load with default key version 1: %v %+v", err, cfg.EmailPayloadKeyVersion)
	}

	for name, env := range map[string][2]string{
		"pepper only":      {"0123456789abcdef0123", ""},
		"key only":         {"", good},
		"short pepper":     {"short", good},
		"key not base64":   {"0123456789abcdef0123", "!!!not-base64!!!"},
		"key wrong length": {"0123456789abcdef0123", "c2hvcnQ="},
	} {
		baseEnv(t)
		t.Setenv("RECOVERY_PEPPER", env[0])
		t.Setenv("EMAIL_PAYLOAD_KEY", env[1])
		if _, err := Load(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestNoiseEnrollmentConfig(t *testing.T) {
	good := "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
	secured := func(t *testing.T) {
		baseEnv(t)
		t.Setenv("RECOVERY_PEPPER", "0123456789abcdef0123")
		t.Setenv("EMAIL_PAYLOAD_KEY", good)
		t.Setenv("NOISE_STATIC_KEY", "")
		t.Setenv("NOISE_KEY_ID", "")
	}
	secured(t)
	if _, err := Load(); err != nil {
		t.Fatalf("unset must load: %v", err)
	}
	secured(t)
	t.Setenv("NOISE_STATIC_KEY", good)
	t.Setenv("NOISE_KEY_ID", "k1")
	if cfg, err := Load(); err != nil || cfg.NoiseKeyID != "k1" {
		t.Fatalf("valid pair: %v", err)
	}
	for name, env := range map[string][2]string{
		"key only":     {good, ""},
		"id only":      {"", "k1"},
		"not base64":   {"!!!", "k1"},
		"wrong length": {"c2hvcnQ=", "k1"},
		"bad id chars": {good, "k 1"},
		"id too long":  {good, "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnop"},
	} {
		secured(t)
		t.Setenv("NOISE_STATIC_KEY", env[0])
		t.Setenv("NOISE_KEY_ID", env[1])
		if _, err := Load(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// Setup grants are signed with the pepper, so enrollment cannot run without it.
	baseEnv(t)
	t.Setenv("NOISE_STATIC_KEY", good)
	t.Setenv("NOISE_KEY_ID", "k1")
	if _, err := Load(); err == nil {
		t.Error("noise key without account-security secrets accepted")
	}
}
