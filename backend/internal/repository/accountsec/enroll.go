package accountsec

// PostgreSQL implementation of service.EnrollmentRepo against migrations 014–018.
//
// STATUS: written against the migration SQL and statically checked against it
// (schema_test.go). It has NOT been run against a database.

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"ipv6ftp/internal/accountpolicy"
	"ipv6ftp/internal/service"
)

var _ service.EnrollmentRepo = (*Repo)(nil)

func (r *Repo) CreatePendingAccount(ctx context.Context, username, passwordHash string) (string, error) {
	var principalID string
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO iam.principals DEFAULT VALUES RETURNING id::text`).Scan(&principalID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO iam.accounts(principal_id, username, password_hash, device_generation) VALUES ($1::uuid, $2, $3, 1)`, principalID, username, passwordHash); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO catalog.plan_assignments(principal_id, plan_version_id)
			SELECT $1::uuid, id FROM catalog.plan_versions WHERE code = 'registered_free' ORDER BY revision DESC LIMIT 1`, principalID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT iam.record_account_operation($1::uuid, 'registration', NULL)`, principalID)
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return "", service.ErrUsernameTaken
	}
	return principalID, err
}

func (r *Repo) FindEnrollmentLogin(ctx context.Context, username string) (string, string, service.EnrollmentBinding, error) {
	var principalID, passwordHash string
	var binding service.EnrollmentBinding
	err := r.pool.QueryRow(ctx, `
		SELECT a.principal_id::text, a.password_hash, a.credential_version, a.device_generation
		FROM iam.accounts a JOIN iam.principals p ON p.id = a.principal_id
		WHERE LOWER(a.username) = LOWER(BTRIM($1)) AND p.disabled_at IS NULL AND a.deletion_deadline IS NULL
	`, username).Scan(&principalID, &passwordHash, &binding.CredentialVersion, &binding.Generation)
	if errors.Is(err, pgx.ErrNoRows) {
		err = service.ErrAccountNotFound
	}
	return principalID, passwordHash, binding, err
}

func (r *Repo) StoreChallenge(ctx context.Context, id string, c service.EnrollmentChallenge, expires time.Time) error {
	principalID := c.PrincipalID
	// Prune a bounded batch during issuance, outside the account transaction.
	// Skipping locked rows lets an in-flight challenge finish independently.
	if _, err := r.pool.Exec(ctx, `
		WITH expired AS (
			SELECT id FROM iam.enrollment_challenges
			WHERE expires_at <= NOW()
			ORDER BY expires_at, id LIMIT 32 FOR UPDATE SKIP LOCKED
		)
		DELETE FROM iam.enrollment_challenges c USING expired WHERE c.id = expired.id`); err != nil {
		return err
	}
	return r.withTx(ctx, func(tx pgx.Tx) error {
		version, err := lockAccount(ctx, tx, principalID)
		if err != nil {
			return err
		}
		var generation int64
		var pending bool
		if err := tx.QueryRow(ctx, `SELECT device_generation, deletion_deadline IS NOT NULL FROM iam.accounts WHERE principal_id = $1::uuid`,
			principalID).Scan(&generation, &pending); err != nil {
			return err
		}
		if pending {
			return service.ErrPendingDeletion
		}
		if version != c.Binding.CredentialVersion || generation != c.Binding.Generation {
			return service.ErrEnrollRaced
		}
		if _, err := tx.Exec(ctx, `
			UPDATE iam.enrollment_challenges SET consumed_at = NOW()
			 WHERE principal_id = $1::uuid AND consumed_at IS NULL`, principalID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO iam.enrollment_challenges(id, principal_id, nonce, expires_at, credential_version, device_generation, server_key_id, rotation_supported)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)`,
			id, principalID, c.Nonce, expires, c.Binding.CredentialVersion, c.Binding.Generation, c.ServerKeyID, c.RotationSupported)
		return err
	})
}

func (r *Repo) ConsumeChallenge(ctx context.Context, id string, now time.Time) (service.EnrollmentChallenge, error) {
	var c service.EnrollmentChallenge
	err := r.pool.QueryRow(ctx, `
		UPDATE iam.enrollment_challenges SET consumed_at = $2
		 WHERE id = $1::uuid AND consumed_at IS NULL AND expires_at > $2
		  AND server_key_id IS NOT NULL
		RETURNING principal_id::text, nonce, credential_version, device_generation, server_key_id, rotation_supported`, id, now).
		Scan(&c.PrincipalID, &c.Nonce, &c.Binding.CredentialVersion, &c.Binding.Generation, &c.ServerKeyID, &c.RotationSupported)
	if errors.Is(err, pgx.ErrNoRows) {
		return service.EnrollmentChallenge{}, service.ErrChallengeUnusable
	}
	return c, err
}

func (r *Repo) PlanEnrollment(ctx context.Context, principalID string, publicKey []byte) (service.EnrollPlan, error) {
	var p service.EnrollPlan
	err := r.pool.QueryRow(ctx, `
		SELECT a.username, a.device_generation, a.deletion_deadline IS NOT NULL, a.activated_at IS NOT NULL,
		       COALESCE((SELECT d.id::text FROM iam.devices d
		                  WHERE d.noise_static_public_key = $2 AND d.principal_id = a.principal_id AND d.revoked_at IS NULL), '')
		  FROM iam.accounts a
		  JOIN iam.principals pr ON pr.id = a.principal_id
		 WHERE a.principal_id = $1::uuid AND pr.disabled_at IS NULL`, principalID, publicKey).
		Scan(&p.Username, &p.Generation, &p.PendingDeletion, &p.Activated, &p.ExistingDeviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, service.ErrAccountNotFound
	}
	return p, err
}

func (r *Repo) CommitEnrollment(ctx context.Context, c service.EnrollCommit) error {
	refresh, err := unhex(c.RefreshHash)
	if err != nil {
		return err
	}
	return r.withTx(ctx, func(tx pgx.Tx) error {
		version, err := lockAccount(ctx, tx, c.PrincipalID)
		if err != nil {
			return err
		}
		var generation int64
		var pending bool
		if err := tx.QueryRow(ctx, `
			SELECT device_generation, deletion_deadline IS NOT NULL FROM iam.accounts WHERE principal_id = $1::uuid`, c.PrincipalID).
			Scan(&generation, &pending); err != nil {
			return err
		}
		if pending {
			return service.ErrPendingDeletion
		}
		if generation != c.ExpectedGeneration || version != c.ExpectedCredentialVersion {
			return service.ErrEnrollRaced
		}

		var existingID, existingOwner string
		var revokedAt *time.Time
		err = tx.QueryRow(ctx, `
			SELECT id::text, principal_id::text, revoked_at FROM iam.devices WHERE noise_static_public_key = $1 FOR UPDATE`, c.PublicKey).
			Scan(&existingID, &existingOwner, &revokedAt)
		switch {
		case err == nil:
			if existingOwner != c.PrincipalID || revokedAt != nil {
				return service.ErrDeviceKeyTaken
			}
			if existingID != c.DeviceID {
				return service.ErrEnrollRaced
			}
		case errors.Is(err, pgx.ErrNoRows):
			if _, err := tx.Exec(ctx, `
				INSERT INTO iam.devices(id, principal_id, noise_static_public_key) VALUES ($1::uuid, $2::uuid, $3)`,
				c.DeviceID, c.PrincipalID, c.PublicKey); err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
					return service.ErrEnrollRaced
				}
				return err
			}
		default:
			return err
		}

		// Single active phone: every earlier session ends and every other device is revoked.
		// Sessions must be revoked before the new one exists.
		if _, err := tx.Exec(ctx, `
			UPDATE iam.auth_sessions s SET revoked_at = COALESCE(s.revoked_at, NOW())
			  FROM iam.devices d WHERE d.id = s.device_id AND d.principal_id = $1::uuid`, c.PrincipalID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE iam.devices SET revoked_at = COALESCE(revoked_at, NOW())
			 WHERE principal_id = $1::uuid AND id <> $2::uuid AND revoked_at IS NULL`, c.PrincipalID, c.DeviceID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO iam.auth_sessions(id, device_id, expires_at) VALUES ($1::uuid, $2::uuid, $3)`,
			c.SessionID, c.DeviceID, c.SessionExpires); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO iam.refresh_tokens(token_hash, auth_session_id, expires_at) VALUES ($1, $2::uuid, $3)`,
			refresh, c.SessionID, c.SessionExpires); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE iam.accounts SET device_generation = device_generation + 1, profile_revision = profile_revision + 1
			 WHERE principal_id = $1::uuid`, c.PrincipalID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT iam.record_account_operation($1::uuid, 'enrollment', $2::uuid)`, c.PrincipalID, c.SessionID)
		return err
	})
}

func (r *Repo) Activate(ctx context.Context, principalID, sessionID, deviceID string, generation int, operationKey string) error {
	return r.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockAccount(ctx, tx, principalID); err != nil {
			return err
		}
		var valid bool
		err := tx.QueryRow(ctx, `
			SELECT true FROM iam.accounts a
			JOIN iam.devices d ON d.principal_id = a.principal_id
			JOIN iam.auth_sessions s ON s.device_id = d.id
			WHERE a.principal_id = $1::uuid AND a.deletion_deadline IS NULL
			  AND a.device_generation > 0 AND a.device_generation = $4
			  AND d.id = $3::uuid AND d.revoked_at IS NULL
			  AND s.id = $2::uuid AND s.revoked_at IS NULL AND s.expires_at > NOW()
			FOR UPDATE OF d, s`, principalID, sessionID, deviceID, generation).Scan(&valid)
		if errors.Is(err, pgx.ErrNoRows) {
			return service.ErrSessionNotActive
		}
		if err != nil {
			return err
		}
		if !valid {
			return service.ErrSessionNotActive
		}
		if operationKey != "" {
			if _, err := tx.Exec(ctx, `
				DELETE FROM iam.activation_operations WHERE (principal_id, operation_key) IN (
					SELECT principal_id, operation_key FROM iam.activation_operations
					WHERE expires_at <= now() ORDER BY expires_at LIMIT 32 FOR UPDATE SKIP LOCKED
				)`); err != nil {
				return err
			}
			fingerprint := accountpolicy.Fingerprint(principalID, "activation", []byte(sessionID))
			var stored string
			err := tx.QueryRow(ctx, `
				INSERT INTO iam.activation_operations(principal_id, operation_key, fingerprint, expires_at)
				VALUES ($1::uuid, $2, $3, now() + interval '24 hours')
				ON CONFLICT (principal_id, operation_key) DO UPDATE
				SET fingerprint = EXCLUDED.fingerprint, expires_at = EXCLUDED.expires_at
				WHERE iam.activation_operations.expires_at <= now()
				RETURNING fingerprint`, principalID, operationKey, fingerprint).Scan(&stored)
			if errors.Is(err, pgx.ErrNoRows) {
				err = tx.QueryRow(ctx, `SELECT fingerprint FROM iam.activation_operations
					WHERE principal_id = $1::uuid AND operation_key = $2`, principalID, operationKey).Scan(&stored)
				if err != nil {
					return err
				}
				if stored != fingerprint {
					return accountpolicy.ErrOperationConflict
				}
				return nil
			}
			if err != nil {
				return err
			}
		}
		var acked bool
		if err := tx.QueryRow(ctx, `SELECT recovery_ack_at IS NOT NULL FROM iam.accounts WHERE principal_id = $1::uuid`, principalID).Scan(&acked); err != nil {
			return err
		}
		if !acked {
			return service.ErrNotAcknowledged
		}
		result, err := tx.Exec(ctx, `
			UPDATE iam.accounts SET activated_at = NOW(), profile_revision = profile_revision + 1
			 WHERE principal_id = $1::uuid AND activated_at IS NULL`, principalID)
		if err != nil || result.RowsAffected() == 0 {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT iam.record_account_operation($1::uuid, 'activation', $2::uuid)`, principalID, sessionID)
		return err
	})
}

func (r *Repo) Snapshot(ctx context.Context, principalID, sessionID, deviceID string) (service.SnapshotData, error) {
	var d service.SnapshotData
	var valid bool
	err := r.pool.QueryRow(ctx, `
		SELECT a.username, a.profile_revision, a.device_generation, a.deletion_deadline IS NOT NULL, a.activated_at IS NOT NULL,
		       s.expires_at > NOW() AND s.revoked_at IS NULL AND dv.revoked_at IS NULL, dv.noise_static_public_key,
		       COALESCE((SELECT last_sequence FROM iam.account_event_sequences WHERE principal_id = a.principal_id), 0)
		  FROM iam.accounts a
		  JOIN iam.principals pr ON pr.id = a.principal_id
		  JOIN iam.devices dv ON dv.principal_id = a.principal_id AND dv.id = $3::uuid
		  JOIN iam.auth_sessions s ON s.device_id = dv.id AND s.id = $2::uuid
		 WHERE a.principal_id = $1::uuid AND pr.disabled_at IS NULL`, principalID, sessionID, deviceID).
		Scan(&d.Username, &d.Revision, &d.Generation, &d.PendingDeletion, &d.Activated, &valid, &d.DevicePublicKey, &d.EventSequence)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, service.ErrAccountNotFound
	}
	if err != nil {
		return d, err
	}
	if !valid {
		return d, service.ErrSessionNotActive
	}
	return d, nil
}
