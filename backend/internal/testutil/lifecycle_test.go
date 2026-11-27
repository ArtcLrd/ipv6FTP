package testutil

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeLifecycle struct {
	exists                   bool
	oid, owner               string
	created, dropped, locked bool
	identityErr, dropErr     error
}

func (f *fakeLifecycle) Lock(context.Context) (func(), error) {
	if f.locked {
		return nil, errors.New("locked")
	}
	f.locked = true
	return func() { f.locked = false }, nil
}
func (f *fakeLifecycle) DatabaseExists(context.Context, string) (bool, error) { return f.exists, nil }
func (f *fakeLifecycle) CreateDatabase(_ context.Context, name, owner string) (string, error) {
	f.created = true
	f.oid = "42"
	f.owner = owner
	return f.oid, nil
}
func (f *fakeLifecycle) DatabaseIdentity(context.Context, string) (string, string, error) {
	return f.oid, f.owner, f.identityErr
}
func (f *fakeLifecycle) DropDatabase(context.Context, string) error {
	f.dropped = true
	return f.dropErr
}

const safeDSN = "postgres://ipv6ftp_auto_test:pw@127.0.0.1:5432/postgres"

func TestRunDisposableCreatesAndDropsOnlyOwnedDatabase(t *testing.T) {
	f := &fakeLifecycle{}
	called := false
	err := RunDisposable(context.Background(), f, safeDSN, func(_ context.Context, dsn string) error {
		called = true
		if !strings.HasSuffix(dsn, "/ipv6test") {
			t.Fatalf("unexpected target %q", dsn)
		}
		return nil
	})
	if err != nil || !called || !f.created || !f.dropped || f.locked {
		t.Fatalf("err=%v called=%v state=%+v", err, called, f)
	}
}
func TestRunDisposableRejectsInvalidDSNBeforeLock(t *testing.T) {
	f := &fakeLifecycle{}
	err := RunDisposable(context.Background(), f, "postgres://postgres@127.0.0.1/postgres", func(context.Context, string) error {
		t.Fatal("callback ran")
		return nil
	})
	if err == nil || f.locked || f.created || f.dropped {
		t.Fatalf("invalid DSN reached lifecycle operations: err=%v state=%+v", err, f)
	}
}

func TestRunDisposableRefusesExistingDatabase(t *testing.T) {
	f := &fakeLifecycle{exists: true}
	err := RunDisposable(context.Background(), f, safeDSN, func(context.Context, string) error { t.Fatal("callback ran"); return nil })
	if !errors.Is(err, ErrDatabaseExists) || f.created || f.dropped || f.locked {
		t.Fatalf("unsafe result err=%v state=%+v", err, f)
	}
}
func TestRunDisposablePreservesDatabaseAfterIdentityChange(t *testing.T) {
	f := &fakeLifecycle{}
	err := RunDisposable(context.Background(), f, safeDSN, func(context.Context, string) error { f.oid = "different"; return nil })
	if err == nil || f.dropped {
		t.Fatalf("err=%v dropped=%v", err, f.dropped)
	}
}
func TestRunDisposableJoinsCallbackAndCleanupErrors(t *testing.T) {
	callbackErr := errors.New("callback failed")
	dropErr := errors.New("drop failed")
	f := &fakeLifecycle{dropErr: dropErr}
	err := RunDisposable(context.Background(), f, safeDSN, func(context.Context, string) error { return callbackErr })
	if !errors.Is(err, callbackErr) || !errors.Is(err, dropErr) {
		t.Fatalf("errors not joined: %v", err)
	}
}

func TestRunDisposableRefusesCleanupOnIdentityOrOwnerMismatch(t *testing.T) {
	for _, tc := range []struct{ name, oid, owner string }{{"oid", "changed", AutoTestRole}, {"owner", "42", "other"}} {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeLifecycle{}
			// Mutate the captured identity after creation, before deferred verification.
			err := RunDisposable(context.Background(), f, safeDSN, func(context.Context, string) error { f.oid, f.owner = tc.oid, tc.owner; return nil })
			if err == nil || f.dropped {
				t.Fatalf("err=%v dropped=%v", err, f.dropped)
			}
		})
	}
}

func TestValidateRunnerDSN(t *testing.T) {
	for _, tc := range []struct {
		dsn string
		ok  bool
	}{{safeDSN, true}, {"postgres://postgres:pw@127.0.0.1:5432/postgres", false}, {"postgres://ipv6ftp_auto_test:pw@127.0.0.1:5432/ipv6ftp", false}, {"postgres://ipv6ftp_auto_test:pw@host.invalid:5432/postgres", false}} {
		if (ValidateRunnerDSN(tc.dsn) == nil) != tc.ok {
			t.Errorf("unexpected validation for %q", tc.dsn)
		}
	}
}
