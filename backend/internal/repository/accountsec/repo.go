// Package accountsec is the PostgreSQL implementation of service.AccountSecurityRepo
// against the schema from migrations 014 and 016. It lives in its own package
// because it needs service types and service already imports repository.
//
// STATUS: written against the migration SQL and statically checked against it
// (see schema_test.go). It has NOT been run against a database.
package accountsec

import (
	"context"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"ipv6ftp/internal/accountpolicy"
	"ipv6ftp/internal/service"
)

// Repo implements service.AccountSecurityRepo.
type Repo struct{ pool *pgxpool.Pool }

var _ service.AccountSecurityRepo = (*Repo)(nil)

func New(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

const uniqueViolation = "23505"

func unhex(s string) ([]byte, error) {
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 32 {
		return nil, errors.New("verifier must be 32 bytes of hex")
	}
	return b, nil
}

// withTx runs fn in a transaction and always rolls back on error.
func (r *Repo) withTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// lockAccount serialises concurrent security changes for one account and
// reports ErrAccountNotFound for unknown or disabled principals.
func lockAccount(ctx context.Context, tx pgx.Tx, principalID string) (version int, err error) {
	err = tx.QueryRow(ctx, `
		SELECT a.credential_version
		  FROM iam.accounts a
		  JOIN iam.principals p ON p.id = a.principal_id
		 WHERE a.principal_id = $1::uuid AND p.disabled_at IS NULL
		   FOR UPDATE OF a`, principalID).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, service.ErrAccountNotFound
	}
	return version, err
}

func (r *Repo) GetCredential(ctx context.Context, principalID string) (service.AccountCredential, error) {
	var c service.AccountCredential
	err := r.pool.QueryRow(ctx, `
		SELECT a.password_hash, a.credential_version, a.recovery_ack_at IS NOT NULL
		  FROM iam.accounts a
		  JOIN iam.principals p ON p.id = a.principal_id
		 WHERE a.principal_id = $1::uuid AND p.disabled_at IS NULL`, principalID).
		Scan(&c.PasswordHash, &c.Version, &c.RecoveryAcked)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, service.ErrAccountNotFound
	}
	return c, err
}

func (r *Repo) FindPrincipalByUsername(ctx context.Context, username string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx, `
		SELECT a.principal_id::text
		  FROM iam.accounts a
		  JOIN iam.principals p ON p.id = a.principal_id
		 WHERE LOWER(a.username) = LOWER($1) AND p.disabled_at IS NULL`, username).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", service.ErrAccountNotFound
	}
	return id, err
}

func (r *Repo) FindPrincipalByVerifiedEmail(ctx context.Context, email string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx, `
		SELECT e.principal_id::text
		  FROM iam.recovery_emails e
		  JOIN iam.principals p ON p.id = e.principal_id
		 WHERE e.email_canonical = $1 AND p.disabled_at IS NULL`, email).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", service.ErrAccountNotFound
	}
	return id, err
}

func (r *Repo) ReplaceRecoverySet(ctx context.Context, principalID string, expectedVersion int, verifiers []string) error {
	decoded := make([][]byte, len(verifiers))
	for i, v := range verifiers {
		b, err := unhex(v)
		if err != nil {
			return err
		}
		decoded[i] = b
	}
	return r.withTx(ctx, func(tx pgx.Tx) error {
		version, err := lockAccount(ctx, tx, principalID)
		if err != nil {
			return err
		}
		if version != expectedVersion {
			return service.ErrStaleCredential
		}
		if _, err := tx.Exec(ctx, `
			UPDATE iam.recovery_code_sets SET retired_at = NOW()
			 WHERE principal_id = $1::uuid AND retired_at IS NULL`, principalID); err != nil {
			return err
		}
		var setID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO iam.recovery_code_sets (principal_id) VALUES ($1::uuid) RETURNING id::text`, principalID).Scan(&setID); err != nil {
			return err
		}
		for _, v := range decoded {
			if _, err := tx.Exec(ctx, `INSERT INTO iam.recovery_codes (set_id, verifier) VALUES ($1::uuid, $2)`, setID, v); err != nil {
				return err
			}
		}
		// A new set must be acknowledged again.
		_, err = tx.Exec(ctx, `UPDATE iam.accounts SET recovery_ack_at = NULL WHERE principal_id = $1::uuid`, principalID)
		return err
	})
}

func (r *Repo) AckRecoverySet(ctx context.Context, principalID, verifier string) error {
	decoded, err := unhex(verifier)
	if err != nil {
		return err
	}
	return r.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockAccount(ctx, tx, principalID); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
		UPDATE iam.accounts a SET recovery_ack_at = COALESCE(a.recovery_ack_at, NOW())
		 WHERE a.principal_id = $1::uuid
		   AND EXISTS (SELECT 1 FROM iam.recovery_code_sets s JOIN iam.recovery_codes c ON c.set_id = s.id
		                WHERE s.principal_id = a.principal_id AND s.retired_at IS NULL
		                  AND c.verifier = $2 AND c.consumed_at IS NULL)`, principalID, decoded)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return service.ErrAccountNotFound
		}
		return nil
	})
}

func (r *Repo) ActiveRecoveryVerifiers(ctx context.Context, principalID string) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT encode(c.verifier, 'hex')
		  FROM iam.recovery_codes c
		  JOIN iam.recovery_code_sets s ON s.id = c.set_id
		 WHERE s.principal_id = $1::uuid AND s.retired_at IS NULL AND c.consumed_at IS NULL`, principalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (r *Repo) ConsumeRecoveryVerifier(ctx context.Context, principalID, verifier string) (bool, error) {
	b, err := unhex(verifier)
	if err != nil {
		return false, err
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE iam.recovery_codes c SET consumed_at = NOW()
		  FROM iam.recovery_code_sets s
		 WHERE c.set_id = s.id AND s.principal_id = $1::uuid AND s.retired_at IS NULL
		   AND c.verifier = $2 AND c.consumed_at IS NULL`, principalID, b)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (r *Repo) CreateRecoveryGrant(ctx context.Context, principalID string, credentialVersion int, method, tokenHash string, expires time.Time) error {
	b, err := unhex(tokenHash)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO iam.recovery_grants (principal_id, credential_version, method, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3, $4, $5)`, principalID, credentialVersion, method, b, expires)
	return err
}

func (r *Repo) ConsumeRecoveryGrant(ctx context.Context, tokenHash string, now time.Time) (string, int, error) {
	b, err := unhex(tokenHash)
	if err != nil {
		return "", 0, service.ErrGrantUnusable
	}
	var pid string
	var version int
	err = r.pool.QueryRow(ctx, `
		UPDATE iam.recovery_grants SET used_at = $2
		 WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > $2
		RETURNING principal_id::text, credential_version`, b, now).Scan(&pid, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, service.ErrGrantUnusable
	}
	return pid, version, err
}

func (r *Repo) ApplyCredentialChange(ctx context.Context, principalID string, expectedVersion int, newHash string, revokeDevices bool) error {
	return r.withTx(ctx, func(tx pgx.Tx) error {
		current, err := lockAccount(ctx, tx, principalID)
		if err != nil {
			return err
		}
		if current != expectedVersion {
			return service.ErrStaleCredential
		}
		if _, err := tx.Exec(ctx, `
			UPDATE iam.accounts SET password_hash = $2, credential_version = credential_version + 1
			 WHERE principal_id = $1::uuid`, principalID, newHash); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE iam.auth_sessions SET revoked_at = NOW()
			 WHERE revoked_at IS NULL
			   AND device_id IN (SELECT id FROM iam.devices WHERE principal_id = $1::uuid)`, principalID); err != nil {
			return err
		}
		if revokeDevices {
			if _, err := tx.Exec(ctx, `
				UPDATE iam.devices SET revoked_at = NOW()
				 WHERE principal_id = $1::uuid AND revoked_at IS NULL`, principalID); err != nil {
				return err
			}
		}
		// Any outstanding recovery grant belongs to the old credential.
		_, err = tx.Exec(ctx, `
			UPDATE iam.recovery_grants SET revoked_at = NOW()
			 WHERE principal_id = $1::uuid AND used_at IS NULL AND revoked_at IS NULL`, principalID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT iam.record_account_operation($1::uuid, 'credentials_changed', NULL), iam.append_account_event($1::uuid, 'credentials_changed', '{}'::jsonb)`, principalID)
		return err
	})
}

func (r *Repo) SupersedeAndStoreChallenge(ctx context.Context, c service.Challenge, item service.OutboxItem) (string, error) {
	verifier, err := unhex(c.State.Verifier)
	if err != nil {
		return "", err
	}
	var id string
	err = r.withTx(ctx, func(tx pgx.Tx) error {
		// Serialise issues for one account so the one-active-challenge index cannot race.
		if _, err := lockAccount(ctx, tx, c.PrincipalID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE iam.email_challenges SET superseded_at = NOW()
			 WHERE purpose = $1 AND principal_id = $2::uuid AND address_version = $3
			   AND consumed_at IS NULL AND superseded_at IS NULL`, c.Purpose, c.PrincipalID, c.AddressVersion); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO iam.email_challenges (purpose, principal_id, email_canonical, address_version, verifier, attempts, expires_at)
			VALUES ($1, $2::uuid, $3, $4, $5, $6, $7) RETURNING id::text`,
			c.Purpose, c.PrincipalID, c.Email, c.AddressVersion, verifier, c.State.Attempts, c.State.ExpiresAt).Scan(&id); err != nil {
			return err
		}
		// A bounced or complained-about address gets no mail, but the caller cannot tell.
		_, err := tx.Exec(ctx, `
			INSERT INTO iam.email_outbox (challenge_id, recipient_canonical, template, payload_ciphertext, key_version, expires_at)
			SELECT $1::uuid, $2, $3, $4, $5, $6
			 WHERE NOT EXISTS (SELECT 1 FROM iam.email_suppressions WHERE email_canonical = $2)`,
			id, item.Recipient, item.Template, item.Ciphertext, item.KeyVersion, item.ExpiresAt)
		return err
	})
	return id, err
}

func (r *Repo) RecentChallengeIssues(ctx context.Context, purpose, principalID string, since time.Time) ([]time.Time, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT created_at FROM iam.email_challenges
		 WHERE purpose = $1 AND principal_id = $2::uuid AND created_at >= $3`, purpose, principalID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []time.Time
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *Repo) GetChallenge(ctx context.Context, id string) (service.Challenge, error) {
	var c service.Challenge
	var attempts int16
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, purpose, COALESCE(principal_id::text, ''), email_canonical, address_version,
		       encode(verifier, 'hex'), attempts, expires_at
		  FROM iam.email_challenges
		 WHERE id = $1::uuid AND consumed_at IS NULL AND superseded_at IS NULL`, id).
		Scan(&c.ID, &c.Purpose, &c.PrincipalID, &c.Email, &c.AddressVersion, &c.State.Verifier, &attempts, &c.State.ExpiresAt)
	if err != nil {
		// A malformed id (22P02) is treated the same as a missing row.
		var pgErr *pgconn.PgError
		if errors.Is(err, pgx.ErrNoRows) || (errors.As(err, &pgErr) && pgErr.Code == "22P02") {
			return service.Challenge{}, service.ErrAccountNotFound
		}
		return service.Challenge{}, err
	}
	c.State.Attempts = int(attempts)
	return c, nil
}

func (r *Repo) SaveChallengeState(ctx context.Context, id string, state accountpolicy.EmailChallenge, consumed bool) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE iam.email_challenges
		   SET attempts = $2, consumed_at = CASE WHEN $3 THEN NOW() ELSE consumed_at END
		 WHERE id = $1::uuid AND consumed_at IS NULL`, id, state.Attempts, consumed)
	return err
}

func (r *Repo) AssignVerifiedEmail(ctx context.Context, principalID, email string) error {
	return r.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockAccount(ctx, tx, principalID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO iam.recovery_emails (principal_id, email_canonical) VALUES ($1::uuid, $2)
			ON CONFLICT (principal_id) DO UPDATE
			   SET email_canonical = EXCLUDED.email_canonical,
			       address_version = iam.recovery_emails.address_version + 1,
			       verified_at = NOW()`, principalID, email)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
			return service.ErrEmailTaken
		}
		return err
	})
}
