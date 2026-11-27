//go:build integration

package accountsec

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ipv6ftp/internal/accountpolicy"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/service"
	"ipv6ftp/internal/testutil"
)

// This test creates and removes its own accounts on an explicitly supplied,
// migrated, disposable PostgreSQL target.
func TestPostgresRegisteredEnrollment(t *testing.T) {
	dsn := testutil.RequirePostgresDSN(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("could not initialize test database pool")
	}
	defer pool.Close()
	repo := New(pool)
	commit := func(principal string, generation int64) service.EnrollCommit {
		key, err := ecdh.X25519().GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		random := make([]byte, 32)
		if _, err := rand.Read(random); err != nil {
			t.Fatal(err)
		}
		uuid := func() string {
			var b [16]byte
			if _, err := rand.Read(b[:]); err != nil {
				t.Fatal(err)
			}
			hex := fmt.Sprintf("%x", b)
			return fmt.Sprintf("%s-%s-%s-%s-%s", hex[:8], hex[8:12], hex[12:16], hex[16:20], hex[20:])
		}
		return service.EnrollCommit{PrincipalID: principal, DeviceID: uuid(), SessionID: uuid(),
			PublicKey: key.PublicKey().Bytes(), ExpectedGeneration: generation, ExpectedCredentialVersion: 1,
			RefreshHash: fmt.Sprintf("%x", random), SessionExpires: time.Now().Add(time.Hour)}
	}
	const hash = "test-only-unused-password-hash-aaaaaaaa"
	for _, scenario := range []string{"competing", "password_change", "recovery", "logout", "legacy_cutover"} {
		t.Run(scenario, func(t *testing.T) {
			var nonce [10]byte
			if _, err := rand.Read(nonce[:]); err != nil {
				t.Fatal(err)
			}
			principal, err := repo.CreatePendingAccount(ctx, fmt.Sprintf("it_%x", nonce), hash)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				if _, err := pool.Exec(cleanup, "DELETE FROM iam.principals WHERE id = $1::uuid", principal); err != nil {
					t.Error("test account cleanup failed")
				}
			})
			generation := int64(1)
			if scenario == "legacy_cutover" {
				legacyCommit := commit(principal, 0)
				newHash := fmt.Sprintf("%x", sha256.Sum256([]byte(legacyCommit.RefreshHash)))
				testLegacyCutover(ctx, t, pool, legacyCommit, newHash)
				return
			}
			var oldSession string
			if scenario == "logout" {
				initial := commit(principal, generation)
				if err := repo.CommitEnrollment(ctx, initial); err != nil {
					t.Fatal(err)
				}
				oldSession = initial.SessionID
				generation++
			}
			left, right := commit(principal, generation), commit(principal, generation)
			result := make(chan error, 2)
			go func() { result <- repo.CommitEnrollment(ctx, left) }()
			if scenario == "competing" {
				go func() { result <- repo.CommitEnrollment(ctx, right) }()
			} else if scenario == "logout" {
				identity := &repository.PgIdentityRepo{Pool: pool}
				go func() { result <- identity.RevokeSession(ctx, principal, oldSession) }()
			} else {
				go func() { result <- repo.ApplyCredentialChange(ctx, principal, 1, hash, scenario == "recovery") }()
			}
			successes, conflicts := 0, 0
			for i := 0; i < 2; i++ {
				err := <-result
				switch {
				case err == nil:
					successes++
				case errors.Is(err, service.ErrEnrollRaced):
					conflicts++
				default:
					t.Fatal(err)
				}
			}
			var authorized int
			err = pool.QueryRow(ctx, `
				SELECT count(*) FROM iam.auth_sessions s JOIN iam.devices d ON d.id = s.device_id
				WHERE d.principal_id = $1::uuid AND d.revoked_at IS NULL AND s.revoked_at IS NULL
			`, principal).Scan(&authorized)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "competing" {
				if successes != 1 || conflicts != 1 || authorized != 1 {
					t.Fatalf("competing enrollment produced %d successes, %d conflicts and %d active sessions", successes, conflicts, authorized)
				}
			} else if scenario == "logout" {
				if successes != 2 || authorized != 1 {
					t.Fatalf("logout during replacement produced %d successes and %d active sessions", successes, authorized)
				}
			} else if authorized != 0 {
				t.Fatal("credential change left an authorized session")
			}
			if scenario == "logout" {
				identity := &repository.PgIdentityRepo{Pool: pool}
				if _, err := pool.Exec(ctx, `UPDATE iam.accounts SET recovery_ack_at = now()
					WHERE principal_id = $1::uuid`, principal); err != nil {
					t.Fatal(err)
				}
				for i := 0; i < 2; i++ {
					if err := repo.Activate(ctx, principal, left.SessionID, left.DeviceID, 3, "test-activation"); err != nil {
						t.Fatal(err)
					}
				}
				next := commit(principal, 3)
				if err := repo.CommitEnrollment(ctx, next); err != nil {
					t.Fatal(err)
				}
				if err := repo.Activate(ctx, principal, next.SessionID, next.DeviceID, 4, "test-activation"); !errors.Is(err, accountpolicy.ErrOperationConflict) {
					t.Fatalf("operation key allowed reuse across sessions: %v", err)
				}
				if _, err := pool.Exec(ctx, `UPDATE iam.activation_operations SET expires_at = now() - interval '1 second'
					WHERE principal_id = $1::uuid`, principal); err != nil {
					t.Fatal(err)
				}
				if err := repo.Activate(ctx, principal, next.SessionID, next.DeviceID, 4, "test-activation"); err != nil {
					t.Fatal(err)
				}
				// Enrollment can revoke the old session before logout acquires
				// its lock, so a racing logout may have no event to record.
				if err := identity.RevokeSession(ctx, principal, next.SessionID); err != nil {
					t.Fatal(err)
				}
				if err := identity.RevokeSession(ctx, principal, next.SessionID); err != nil {
					t.Fatal(err)
				}
				var events, outbox int
				err := pool.QueryRow(ctx, `
					SELECT count(*), count(o.audit_id)
					FROM iam.account_audit a LEFT JOIN iam.account_outbox o ON o.audit_id = a.id
					WHERE a.principal_id = $1::uuid AND a.operation = 'session_revoked' AND a.session_id = $2::uuid
				`, principal, next.SessionID).Scan(&events, &outbox)
				if err != nil || events != 1 || outbox != 1 {
					t.Fatalf("first revocation has %d audits and %d outbox entries: %v", events, outbox, err)
				}
				var before, after int64
				if err := pool.QueryRow(ctx, "SELECT profile_revision FROM iam.accounts WHERE principal_id = $1::uuid", principal).Scan(&before); err != nil {
					t.Fatal(err)
				}
				var auditID int64
				rollback := errors.New("test rollback")
				err = repo.withTx(ctx, func(tx pgx.Tx) error {
					if _, err := tx.Exec(ctx, "UPDATE iam.accounts SET profile_revision = profile_revision + 1 WHERE principal_id = $1::uuid", principal); err != nil {
						return err
					}
					if _, err := tx.Exec(ctx, "SELECT iam.record_account_operation($1::uuid, 'test_rollback', NULL)", principal); err != nil {
						return err
					}
					if err := tx.QueryRow(ctx, `
						SELECT a.id FROM iam.account_audit a JOIN iam.account_outbox o ON o.audit_id = a.id
						WHERE a.principal_id = $1::uuid AND a.operation = 'test_rollback'
					`, principal).Scan(&auditID); err != nil {
						return err
					}
					return rollback
				})
				if !errors.Is(err, rollback) {
					t.Fatal(err)
				}
				err = pool.QueryRow(ctx, `
					SELECT profile_revision,
					       (SELECT count(*) FROM iam.account_audit WHERE id = $2),
					       (SELECT count(*) FROM iam.account_outbox WHERE audit_id = $2)
					FROM iam.accounts WHERE principal_id = $1::uuid
				`, principal, auditID).Scan(&after, &events, &outbox)
				if err != nil || after != before || events != 0 || outbox != 0 {
					t.Fatalf("rollback left revision %d (was %d), %d audit records and %d outbox records: %v", after, before, events, outbox, err)
				}
			}
		})
	}
}

func testLegacyCutover(ctx context.Context, t *testing.T, pool *pgxpool.Pool, c service.EnrollCommit, newHash string) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Model a generation-zero session already issued by a legacy replica.
	if _, err := tx.Exec(ctx, "UPDATE iam.accounts SET device_generation = 0 WHERE principal_id = $1::uuid", c.PrincipalID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO iam.devices(id, principal_id, noise_static_public_key) VALUES ($1::uuid, $2::uuid, $3)", c.DeviceID, c.PrincipalID, c.PublicKey); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO iam.auth_sessions(id, device_id, expires_at) VALUES ($1::uuid, $2::uuid, $3)", c.SessionID, c.DeviceID, c.SessionExpires); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO iam.refresh_tokens(token_hash, auth_session_id, expires_at) VALUES (decode($1, 'hex'), $2::uuid, $3)", c.RefreshHash, c.SessionID, c.SessionExpires); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	legacy := &repository.PgIdentityRepo{Pool: pool}
	if err := legacy.ValidateSession(ctx, c.PrincipalID, c.SessionID, c.DeviceID, 1); err != nil {
		t.Fatalf("legacy session rejected before cutover: %v", err)
	}
	_, sessionID, err := legacy.RotateLegacyRefreshToken(ctx, c.RefreshHash, newHash, "", "", "", c.SessionExpires)
	if err != nil {
		t.Fatalf("legacy refresh failed before cutover: %v", err)
	}
	if sessionID != c.SessionID {
		t.Fatalf("legacy refresh returned session ID %q, want %q", sessionID, c.SessionID)
	}
	// Use the rollout statement with a principal filter to protect other fixtures.
	result, err := pool.Exec(ctx, `
		UPDATE iam.auth_sessions s SET revoked_at = now()
		FROM iam.devices d JOIN iam.accounts a ON a.principal_id = d.principal_id
		WHERE s.device_id = d.id AND a.device_generation = 0 AND s.revoked_at IS NULL
		  AND a.principal_id = $1::uuid`, c.PrincipalID)
	if err != nil || result.RowsAffected() != 1 {
		t.Fatalf("expected one retired legacy session: %v", err)
	}
	if err := legacy.ValidateSession(ctx, c.PrincipalID, c.SessionID, c.DeviceID, 1); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("staging accepted retired access session or returned unexpected error: %v", err)
	}
	if _, _, err := legacy.RotateLegacyRefreshToken(ctx, newHash, c.RefreshHash, "", "", "", c.SessionExpires); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("staging accepted retired refresh token or returned unexpected error: %v", err)
	}
}
