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
