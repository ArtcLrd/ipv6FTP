package testutil

import "testing"

func TestValidatePostgresDSN(t *testing.T) {
	for _, tc := range []struct {
		name, dsn string
		valid     bool
	}{
		{"empty", "", false},
		{"keyword", "host=127.0.0.1 dbname=test", false},
		{"remote", "postgres://user:pass@example.com:5432/test", false},
		{"hostname", "postgres://user:pass@localhost:5432/test", false},
		{"no database", "postgres://user:pass@127.0.0.1:5432/", false},
		{"no user", "postgres://127.0.0.1:5432/test", false},
		{"no port", "postgres://user:pass@127.0.0.1/test", false},
		{"override", "postgres://user:pass@127.0.0.1:5432/test?host=example.com", false},
		{"sslmode disable", "postgres://user:pass@127.0.0.1:5432/test?sslmode=disable", true},
		{"compose maintenance URL", "postgres://ipv6ftp_auto_test:0123abcd@127.0.0.1:5432/postgres?sslmode=disable", true},
		{"sslmode require", "postgres://user:pass@127.0.0.1:5432/test?sslmode=require", false},
		{"multiple options", "postgres://user:pass@127.0.0.1:5432/test?sslmode=disable&connect_timeout=5", false},
		{"empty query", "postgres://user:pass@127.0.0.1:5432/test?", false},
		{"ipv4", "postgres://user:pass@127.0.0.1:5432/test", true},
		{"ipv6", "postgresql://user:pass@[::1]:5432/test", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidatePostgresDSN(tc.dsn); (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
}
