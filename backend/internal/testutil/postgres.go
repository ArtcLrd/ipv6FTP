// Package testutil provides helpers for tests; it does not establish database ownership.
package testutil

import (
	"context"
	"errors"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

const isolatedDSNEnv = "IPV6FTP_ISOLATED_TEST_DATABASE_URL"

// ValidatePostgresDSN rejects implicit connection settings and non-loopback targets.
// It cannot establish that a server or database is disposable.
func ValidatePostgresDSN(dsn string) error {
	invalid := errors.New("test DSN must be an explicit PostgreSQL URL with numeric loopback, port, user and database; only sslmode=disable is allowed as a connection option")
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Opaque != "" || u.User == nil || u.User.Username() == "" || !validPostgresQuery(u) || u.Fragment != "" || strings.Trim(u.Path, "/") == "" || strings.Count(u.Path, "/") != 1 {
		return invalid
	}
	ip := net.ParseIP(u.Hostname())
	port, err := strconv.Atoi(u.Port())
	if ip == nil || !ip.IsLoopback() || err != nil || port < 1 || port > 65535 {
		return invalid
	}
	return nil
}

func validPostgresQuery(u *url.URL) bool {
	if u.RawQuery == "" && !u.ForceQuery {
		return true
	}
	query, err := url.ParseQuery(u.RawQuery)
	return err == nil && len(query) == 1 && len(query["sslmode"]) == 1 && query.Get("sslmode") == "disable" && !u.ForceQuery
}

// verifyMarkers requires a per-run unpredictable marker only in the disposable
// test database. It is an accident guard, not a security boundary against a
// malicious database superuser.
func verifyMarkers(ctx context.Context, token string, read func(context.Context) (string, error)) error {
	invalid := errors.New("isolated test database marker verification failed")
	if len(token) != 64 || strings.Trim(token, "0123456789abcdef") != "" {
		return invalid
	}
	value, err := read(ctx)
	if err != nil || value != token {
		return invalid
	}
	return nil
}

// RequirePostgresDSN fails rather than skipping explicitly selected integration tests.
func RequirePostgresDSN(t testing.TB) string {
	t.Helper()
	dsn := os.Getenv(isolatedDSNEnv)
	if err := ValidatePostgresDSN(dsn); err != nil {
		t.Fatalf("%s: %v", isolatedDSNEnv, err)
	}
	u, _ := url.Parse(dsn)
	if strings.TrimPrefix(u.Path, "/") == "postgres" {
		t.Fatal("maintenance database cannot be the test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := verifyMarkers(ctx, os.Getenv("INTEGRATION_STARTUP_MARKER"), func(ctx context.Context) (string, error) {
		conn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			return "", err
		}
		defer conn.Close(ctx)
		var database, user string
		var oid uint32
		var owner string
		err = conn.QueryRow(ctx, `SELECT current_database(), current_user, d.oid, r.rolname FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=current_database()`).Scan(&database, &user, &oid, &owner)
		if err != nil {
			return "", err
		}
		if database != DatabaseName || user != AutoTestRole || oid == 0 || owner != AutoTestRole || (u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") || u.Port() == "" {
			return "", errors.New("test database connection identity mismatch")
		}
		var marker string
		err = conn.QueryRow(ctx, `SELECT marker FROM public.integration_startup_marker WHERE (SELECT count(*) FROM public.integration_startup_marker) = 1`).Scan(&marker)
		return marker, err
	})
	if err != nil {
		t.Fatal(err)
	}
	return dsn
}
