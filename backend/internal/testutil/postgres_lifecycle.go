package testutil

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// PostgresLifecycle keeps the session advisory lock on the maintenance
// connection for the entire run. Close it to release the lock.
type PostgresLifecycle struct{ conn *pgx.Conn }

func ConnectLifecycle(ctx context.Context, dsn string) (*PostgresLifecycle, error) {
	if err := ValidateRunnerDSN(dsn); err != nil {
		return nil, err
	}
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return nil, err
	}
	var user, database string
	var canCreateDB, canCreateRole, isSuperuser, canReplicate bool
	if err = conn.QueryRow(ctx, `SELECT current_user, current_database(),
		rolcreatedb, rolcreaterole, rolsuper, rolreplication
		FROM pg_roles WHERE rolname=current_user`).Scan(&user, &database, &canCreateDB, &canCreateRole, &isSuperuser, &canReplicate); err != nil {
		_ = conn.Close(ctx)
		return nil, err
	}
	if user != AutoTestRole || database != "postgres" || !canCreateDB || canCreateRole || isSuperuser || canReplicate {
		_ = conn.Close(ctx)
		return nil, errors.New("maintenance connection identity or role attributes are unsafe")
	}
	var protectedRole bool
	if err = conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN
		('ipv6ftp_owner', 'ipv6ftp_api', 'ipv6ftp_readonly'))`).Scan(&protectedRole); err != nil {
		_ = conn.Close(ctx)
		return nil, err
	}
	if protectedRole {
		_ = conn.Close(ctx)
		return nil, errors.New("protected application roles exist in test cluster")
	}
	return &PostgresLifecycle{conn: conn}, nil
}
func (p *PostgresLifecycle) Close(ctx context.Context) error { return p.conn.Close(ctx) }
func (p *PostgresLifecycle) Lock(ctx context.Context) (func(), error) {
	var locked bool
	if err := p.conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtext('ipv6ftp.integrationtest.ipv6test'))").Scan(&locked); err != nil {
		return nil, err
	}
	if !locked {
		return nil, errors.New("another integration run holds the ipv6test lock")
	}
	return func() {
		_, _ = p.conn.Exec(context.Background(), "SELECT pg_advisory_unlock(hashtext('ipv6ftp.integrationtest.ipv6test'))")
	}, nil
}
func (p *PostgresLifecycle) DatabaseExists(ctx context.Context, name string) (bool, error) {
	var exists bool
	err := p.conn.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1)", name).Scan(&exists)
	return exists, err
}
func (p *PostgresLifecycle) CreateDatabase(ctx context.Context, name, owner string) (string, error) {
	if name != DatabaseName || owner != AutoTestRole {
		return "", errors.New("refusing unexpected database or owner")
	}
	if _, err := p.conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()+" OWNER "+pgx.Identifier{owner}.Sanitize()); err != nil {
		return "", err
	}
	oid, _, err := p.DatabaseIdentity(ctx, name)
	return oid, err
}
func (p *PostgresLifecycle) DatabaseIdentity(ctx context.Context, name string) (string, string, error) {
	var oid uint32
	var owner string
	err := p.conn.QueryRow(ctx, "SELECT d.oid, r.rolname FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=$1", name).Scan(&oid, &owner)
	return fmt.Sprint(oid), owner, err
}
func (p *PostgresLifecycle) DropDatabase(ctx context.Context, name string) error {
	if name != DatabaseName {
		return errors.New("refusing unexpected database drop")
	}
	_, err := p.conn.Exec(ctx, "DROP DATABASE "+pgx.Identifier{name}.Sanitize())
	if err != nil && strings.Contains(err.Error(), "does not exist") {
		return nil
	}
	return err
}
