package accountsec

// PostgreSQL implementation of service.AccountLifecycleRepo against migrations
// 014, 016 and 017.
//
// STATUS: written against the migration SQL and statically checked against it
// (schema_test.go). It has NOT been run against a database.

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"ipv6ftp/internal/accountpolicy"
	"ipv6ftp/internal/service"
)

var _ service.AccountLifecycleRepo = (*Repo)(nil)

// lockUsernames takes the same advisory locks as the username-reservation
// trigger from migration 017, in a fixed order, so a rename and a concurrent registration of the old name serialise.
func lockUsernames(ctx context.Context, tx pgx.Tx, canonicals ...string) error {
	sort.Strings(canonicals)
	for _, c := range canonicals {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('username-lock:' || $1, 0))`, c); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repo) GetProfile(ctx context.Context, principalID string) (service.AccountProfile, error) {
	var p service.AccountProfile
	err := r.pool.QueryRow(ctx, `
		SELECT a.username, a.profile_revision, a.recovery_ack_at IS NOT NULL, a.username_changed_at, a.deletion_deadline
		  FROM iam.accounts a
		  JOIN iam.principals pr ON pr.id = a.principal_id
		 WHERE a.principal_id = $1::uuid AND pr.disabled_at IS NULL`, principalID).
		Scan(&p.Username, &p.Revision, &p.RecoveryAcked, &p.UsernameChangedAt, &p.DeletionDeadline)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, service.ErrAccountNotFound
	}
	return p, err
}

func (r *Repo) UsernameAvailable(ctx context.Context, canonical string) (bool, error) {
	var taken bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM iam.accounts WHERE LOWER(username) = $1)
		    OR EXISTS (SELECT 1 FROM iam.username_reservations WHERE canonical = $1)`, canonical).Scan(&taken)
	return !taken, err
}

func (r *Repo) ChangeUsername(ctx context.Context, principalID, newCanonical string, now time.Time) error {
	return r.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockAccount(ctx, tx, principalID); err != nil {
			return err
		}
		var oldName string
		var changedAt, deadline *time.Time
		if err := tx.QueryRow(ctx, `
			SELECT username, username_changed_at, deletion_deadline FROM iam.accounts WHERE principal_id = $1::uuid`, principalID).
			Scan(&oldName, &changedAt, &deadline); err != nil {
			return err
		}
		if deadline != nil {
			return service.ErrPendingDeletion
		}
		oldCanon := accountpolicy.CanonicalUsername(oldName)
		if oldCanon == newCanonical {
			return service.ErrUsernameUnchanged
		}
		if err := accountpolicy.CheckUsernameChange(changedAt, now); err != nil {
			return err
		}
		if err := lockUsernames(ctx, tx, oldCanon, newCanonical); err != nil {
			return err
		}
		var taken bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM iam.accounts WHERE LOWER(username) = $1 AND principal_id <> $2::uuid)
			    OR EXISTS (SELECT 1 FROM iam.username_reservations
			                WHERE canonical = $1 AND (kind = 'retired' OR principal_id <> $2::uuid))`, newCanonical, principalID).Scan(&taken); err != nil {
			return err
		}
		if taken {
			return service.ErrUsernameTaken
		}
		// Reclaiming an owned former name releases its reservation.
		if _, err := tx.Exec(ctx, `DELETE FROM iam.username_reservations WHERE canonical = $1 AND principal_id = $2::uuid`, newCanonical, principalID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO iam.username_reservations(canonical, principal_id, kind) VALUES ($1, $2::uuid, 'former')
			ON CONFLICT (canonical) DO NOTHING`, oldCanon, principalID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE iam.accounts SET username = $2, username_changed_at = $3, profile_revision = profile_revision + 1
			 WHERE principal_id = $1::uuid`, principalID, newCanonical, now); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
				return service.ErrUsernameTaken
			}
			return err
		}
		_, err := tx.Exec(ctx, `SELECT iam.record_account_operation($1::uuid, 'username_changed', NULL), iam.append_account_event($1::uuid, 'username_changed', '{}'::jsonb)`, principalID)
		return err
	})
}

func (r *Repo) RequestDeletion(ctx context.Context, principalID string, now time.Time) (time.Time, error) {
	var deadline time.Time
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockAccount(ctx, tx, principalID); err != nil {
			return err
		}
		var existing *time.Time
		if err := tx.QueryRow(ctx, `SELECT deletion_deadline FROM iam.accounts WHERE principal_id = $1::uuid`, principalID).Scan(&existing); err != nil {
			return err
		}
		if existing != nil {
			deadline = *existing
			return nil
		}
		deadline = accountpolicy.DeletionDeadline(now)
		if _, err := tx.Exec(ctx, `
			UPDATE iam.accounts SET deletion_requested_at = $2, deletion_deadline = $3,
			       credential_version = credential_version + 1, profile_revision = profile_revision + 1
			 WHERE principal_id = $1::uuid`, principalID, now, deadline); err != nil {
			return err
		}
		// Authorization ends immediately; cancellation issues new sessions through sign-in.
		if _, err := tx.Exec(ctx, `
			UPDATE iam.auth_sessions s SET revoked_at = COALESCE(s.revoked_at, NOW())
			  FROM iam.devices d WHERE d.id = s.device_id AND d.principal_id = $1::uuid`, principalID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			UPDATE iam.recovery_grants SET revoked_at = COALESCE(revoked_at, NOW())
			 WHERE principal_id = $1::uuid AND used_at IS NULL`, principalID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT iam.record_account_operation($1::uuid, 'deletion_requested', NULL), iam.append_account_event($1::uuid, 'deletion_requested', '{}'::jsonb)`, principalID)
		return err
	})
	return deadline, err
}

func (r *Repo) CancelDeletion(ctx context.Context, principalID string, now time.Time) error {
	return r.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockAccount(ctx, tx, principalID); err != nil {
			return err
		}
		var deadline *time.Time
		if err := tx.QueryRow(ctx, `SELECT deletion_deadline FROM iam.accounts WHERE principal_id = $1::uuid`, principalID).Scan(&deadline); err != nil {
			return err
		}
		if deadline == nil {
			return service.ErrNotPendingDeletion
		}
		if !accountpolicy.DeletionCancelable(*deadline, now) {
			return service.ErrDeletionExpired
		}
		_, err := tx.Exec(ctx, `
			UPDATE iam.accounts SET deletion_requested_at = NULL, deletion_deadline = NULL, profile_revision = profile_revision + 1
			 WHERE principal_id = $1::uuid`, principalID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT iam.record_account_operation($1::uuid, 'deletion_cancelled', NULL), iam.append_account_event($1::uuid, 'deletion_cancelled', '{}'::jsonb)`, principalID)
		return err
	})
}

func (r *Repo) FindAccountForLogin(ctx context.Context, username string) (string, string, error) {
	var id, hash string
	err := r.pool.QueryRow(ctx, `
		SELECT a.principal_id::text, a.password_hash
		  FROM iam.accounts a
		  JOIN iam.principals p ON p.id = a.principal_id
		 WHERE LOWER(a.username) = LOWER($1) AND p.disabled_at IS NULL`, accountpolicy.CanonicalUsername(username)).Scan(&id, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", service.ErrAccountNotFound
	}
	return id, hash, err
}

func (r *Repo) ListSessions(ctx context.Context, principalID string, limit int) ([]service.SessionInfo, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT s.id::text, s.device_id::text, s.issued_at, s.expires_at, s.revoked_at
		  FROM iam.auth_sessions s
		  JOIN iam.devices d ON d.id = s.device_id
		 WHERE d.principal_id = $1::uuid
		 ORDER BY s.issued_at DESC
		 LIMIT $2`, principalID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]service.SessionInfo, 0)
	for rows.Next() {
		var s service.SessionInfo
		if err := rows.Scan(&s.SessionID, &s.DeviceID, &s.IssuedAt, &s.ExpiresAt, &s.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Repo) RevokeSession(ctx context.Context, principalID, sessionID string) (bool, error) {
	var owned bool
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockAccount(ctx, tx, principalID); err != nil {
			return err
		}
		var changed bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM iam.auth_sessions s JOIN iam.devices d ON d.id=s.device_id WHERE s.id=$1::uuid AND d.principal_id=$2::uuid)`, sessionID, principalID).Scan(&owned); err != nil || !owned {
			return err
		}
		if err := tx.QueryRow(ctx, `WITH revoked AS (UPDATE iam.auth_sessions s SET revoked_at=NOW() FROM iam.devices d WHERE s.id=$1::uuid AND d.id=s.device_id AND d.principal_id=$2::uuid AND s.revoked_at IS NULL RETURNING s.id) SELECT EXISTS(SELECT 1 FROM revoked)`, sessionID, principalID).Scan(&changed); err != nil {
			return err
		}
		if !changed {
			return nil
		}
		_, err := tx.Exec(ctx, `SELECT iam.record_account_operation($1::uuid, 'session_revoked', $2::uuid), iam.append_account_event($1::uuid, 'session_revoked', jsonb_build_object('session_id', $2::text))`, principalID, sessionID)
		return err
	})
	return owned, err
}

func (r *Repo) RevokeAllSessions(ctx context.Context, principalID string) error {
	return r.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockAccount(ctx, tx, principalID); err != nil {
			return err
		}
		var changed bool
		if err := tx.QueryRow(ctx, `WITH revoked AS (UPDATE iam.auth_sessions s SET revoked_at=NOW() FROM iam.devices d WHERE d.id=s.device_id AND d.principal_id=$1::uuid AND s.revoked_at IS NULL RETURNING s.id) SELECT EXISTS(SELECT 1 FROM revoked)`, principalID).Scan(&changed); err != nil {
			return err
		}
		if !changed {
			return nil
		}
		_, err := tx.Exec(ctx, `SELECT iam.record_account_operation($1::uuid, 'sessions_revoked', NULL), iam.append_account_event($1::uuid, 'sessions_revoked', '{}'::jsonb)`, principalID)
		return err
	})
}
