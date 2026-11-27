package testutil

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	DatabaseName = "ipv6test"
	AutoTestRole = "ipv6ftp_auto_test"
)

var ErrDatabaseExists = errors.New("ipv6test already exists; inspect it manually; it will not be reused or deleted")

// LifecycleDB is the narrow interface used to test lifecycle decisions offline.
type LifecycleDB interface {
	Lock(context.Context) (func(), error)
	DatabaseExists(context.Context, string) (bool, error)
	CreateDatabase(context.Context, string, string) (string, error)
	DatabaseIdentity(context.Context, string) (string, string, error) // OID, owner
	DropDatabase(context.Context, string) error
}

// RunDisposable serializes the complete callback and drops only the database
// created by this invocation, after confirming its original OID and owner.
func RunDisposable(ctx context.Context, db LifecycleDB, maintenanceDSN string, run func(context.Context, string) error) (result error) {
	if err := ValidateRunnerDSN(maintenanceDSN); err != nil {
		return err
	}
	unlock, err := db.Lock(ctx)
	if err != nil {
		return fmt.Errorf("acquire integration-run lock: %w", err)
	}
	defer unlock()

	exists, err := db.DatabaseExists(ctx, DatabaseName)
	if err != nil {
		return fmt.Errorf("check fixed test database: %w", err)
	}
	if exists {
		return ErrDatabaseExists
	}

	oid, err := db.CreateDatabase(ctx, DatabaseName, AutoTestRole)
	if err != nil {
		return fmt.Errorf("create fixed test database: %w", err)
	}
	if oid == "" {
		return errors.New("database creation returned no identity; refusing cleanup")
	}

	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		currentOID, owner, verifyErr := db.DatabaseIdentity(cleanupCtx, DatabaseName)
		if verifyErr != nil {
			result = errors.Join(result, fmt.Errorf("verify owned test database before cleanup: %w", verifyErr))
			return
		}
		if currentOID != oid || owner != AutoTestRole {
			result = errors.Join(result, errors.New("test database identity/owner changed; refusing cleanup"))
			return
		}
		if dropErr := db.DropDatabase(cleanupCtx, DatabaseName); dropErr != nil {
			result = errors.Join(result, fmt.Errorf("drop owned test database: %w", dropErr))
		}
	}()

	targetDSN, err := TargetDSN(maintenanceDSN)
	if err != nil {
		return err
	}
	return run(ctx, targetDSN)
}

// ValidateRunnerDSN accepts only explicit loopback PostgreSQL URLs for the
// dedicated automated role. It rejects implicit libpq options and any target DB.
func ValidateRunnerDSN(raw string) error {
	if err := ValidatePostgresDSN(raw); err != nil {
		return err
	}
	u, _ := url.Parse(raw)
	if u.User.Username() != AutoTestRole {
		return fmt.Errorf("runner must connect only as %s", AutoTestRole)
	}
	if strings.Trim(u.Path, "/") != "postgres" {
		return errors.New("maintenance DSN must target postgres database")
	}
	return nil
}

// TargetDSN replaces only the database path after lifecycle creation.
func TargetDSN(maintenanceDSN string) (string, error) {
	if err := ValidateRunnerDSN(maintenanceDSN); err != nil {
		return "", err
	}
	u, _ := url.Parse(maintenanceDSN)
	u.Path = "/" + DatabaseName
	return u.String(), nil
}
