package repository

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ipv6ftp/internal/models"
)

var ErrRefreshRotationCommitted = errors.New("refresh rotation committed but response could not be completed")
var ErrRefreshTokenReuse = errors.New("refresh token reuse detected")
var ErrLegacyIssuanceRestricted = errors.New("account requires V2 enrollment")

func lockLegacyAccount(ctx context.Context, tx pgx.Tx, principalID string) error {
	var generation int64
	err := tx.QueryRow(ctx, `SELECT device_generation FROM iam.accounts
		WHERE principal_id = $1::uuid AND deletion_deadline IS NULL FOR UPDATE`, principalID).Scan(&generation)
	if err == nil && generation != 0 {
		return ErrLegacyIssuanceRestricted
	}
	return err
}

type IdentityRepo interface {
	BootstrapGuest(context.Context, models.GuestBootstrapRequest, string, string) (models.User, string, error)
	Register(context.Context, models.RegisterRequest, string, string, string) (models.User, string, error)
	FindPasswordIdentity(context.Context, string) (PasswordIdentity, error)
	MergeGuest(context.Context, string, string) error
	GetProfile(context.Context, string) (models.User, error)
	AttachDevice(context.Context, string, *models.DeviceInstallationRequest) (string, error)
	CreateAuthSession(context.Context, string, string, string, string, string, string, time.Time) (string, error)
	RotateRefreshToken(context.Context, string, string, string, string, string, time.Time) (models.User, string, error)
	RevokeAllSessions(context.Context, string) error
	RevokeSession(context.Context, string, string) error
	ValidateSession(context.Context, string, string, string, int) error
	GetAuthorization(context.Context, string) (models.AuthorizationContext, error)
	ListPendingPrompts(context.Context, string) ([]models.ConversionPrompt, error)
	RecordPromptAction(context.Context, string, models.PromptActionRequest) error
	ListSessions(context.Context, string, string) ([]models.AuthSessionSummary, error)
}

type PasswordIdentity struct {
	PrincipalID           string
	Username              string
	AccountType           string
	Status                string
	PasswordHash          string
	DefaultInstallationID string
}

type PgIdentityRepo struct{ Pool *pgxpool.Pool }

func NewPgIdentityRepo(pool *pgxpool.Pool) *PgIdentityRepo { return &PgIdentityRepo{Pool: pool} }

func (r *PgIdentityRepo) BootstrapGuest(context.Context, models.GuestBootstrapRequest, string, string) (models.User, string, error) {
	return models.User{}, "", errors.New("guest bootstrap is deferred")
}

func (r *PgIdentityRepo) Register(ctx context.Context, req models.RegisterRequest, passwordHash, _, _ string) (models.User, string, error) {
	key, err := decodeNoiseKey(req.Installation)
	if err != nil {
		return models.User{}, "", err
	}
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return models.User{}, "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var principalID, deviceID string
	if err = tx.QueryRow(ctx, `INSERT INTO iam.principals DEFAULT VALUES RETURNING id::text`).Scan(&principalID); err != nil {
		return models.User{}, "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO iam.accounts(principal_id, username, password_hash) VALUES ($1::uuid, $2, $3)`, principalID, strings.TrimSpace(req.Username), passwordHash); err != nil {
		return models.User{}, "", err
	}
	if err = tx.QueryRow(ctx, `INSERT INTO iam.devices(principal_id, noise_static_public_key) VALUES ($1::uuid, $2) RETURNING id::text`, principalID, key).Scan(&deviceID); err != nil {
		return models.User{}, "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO catalog.plan_assignments(principal_id, plan_version_id) SELECT $1::uuid, id FROM catalog.plan_versions WHERE code = 'registered_free' ORDER BY revision DESC LIMIT 1`, principalID); err != nil {
		return models.User{}, "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return models.User{}, "", err
	}
	return models.User{ID: principalID, Username: strings.TrimSpace(req.Username), AccountType: "registered", PlanCode: "registered_free", AuthVersion: 1, DeviceID: deviceID, Role: "app_user", Status: "active"}, deviceID, nil
}

func (r *PgIdentityRepo) FindPasswordIdentity(ctx context.Context, username string) (PasswordIdentity, error) {
	var identity PasswordIdentity
	err := r.Pool.QueryRow(ctx, `SELECT p.id::text, a.username, a.password_hash, COALESCE((SELECT d.id::text FROM iam.devices d WHERE d.principal_id = p.id AND d.revoked_at IS NULL ORDER BY d.created_at DESC LIMIT 1), '') FROM iam.accounts a JOIN iam.principals p ON p.id = a.principal_id WHERE LOWER(a.username) = LOWER($1) AND p.disabled_at IS NULL AND a.deletion_deadline IS NULL`, strings.TrimSpace(username)).Scan(&identity.PrincipalID, &identity.Username, &identity.PasswordHash, &identity.DefaultInstallationID)
	identity.AccountType = "registered"
	identity.Status = "active"
	return identity, err
}

func (r *PgIdentityRepo) MergeGuest(context.Context, string, string) error {
	return errors.New("guest merge is deferred")
}

func (r *PgIdentityRepo) GetProfile(ctx context.Context, principalID string) (models.User, error) {
	var user models.User
	err := r.Pool.QueryRow(ctx, `SELECT p.id::text, a.username, COALESCE((SELECT pv.code FROM catalog.plan_assignments pa JOIN catalog.plan_versions pv ON pv.id = pa.plan_version_id WHERE pa.principal_id = p.id AND pa.effective_from <= NOW() AND (pa.effective_until IS NULL OR pa.effective_until > NOW()) ORDER BY pa.effective_from DESC LIMIT 1), '') FROM iam.principals p JOIN iam.accounts a ON a.principal_id = p.id WHERE p.id = $1::uuid AND p.disabled_at IS NULL AND a.deletion_deadline IS NULL`, principalID).Scan(&user.ID, &user.Username, &user.PlanCode)
	if err != nil {
		return models.User{}, err
	}
	user.AccountType = "registered"
	user.AuthVersion = 1
	user.Role = "app_user"
	user.Roles = []string{"app_user"}
	user.Permissions = registeredPermissions()
	user.Status = "active"
	return user, nil
}

func (r *PgIdentityRepo) AttachDevice(ctx context.Context, principalID string, installation *models.DeviceInstallationRequest) (string, error) {
	key, err := decodeNoiseKey(installation)
	if err != nil {
		return "", err
	}
	var deviceID string
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err = lockLegacyAccount(ctx, tx, principalID); err != nil {
		return "", err
	}
	if err = tx.QueryRow(ctx, `INSERT INTO iam.devices(principal_id, noise_static_public_key) VALUES ($1::uuid, $2) ON CONFLICT (noise_static_public_key) DO UPDATE SET noise_static_public_key = EXCLUDED.noise_static_public_key WHERE iam.devices.principal_id = EXCLUDED.principal_id AND iam.devices.revoked_at IS NULL RETURNING id::text`, principalID, key).Scan(&deviceID); err != nil {
		return "", err
	}
	return deviceID, tx.Commit(ctx)
}

func (r *PgIdentityRepo) CreateAuthSession(ctx context.Context, principalID, deviceID, refreshHash, _, _, _ string, expiresAt time.Time) (string, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var sessionID string
	if err = lockLegacyAccount(ctx, tx, principalID); err != nil {
		return "", err
	}
	err = tx.QueryRow(ctx, `INSERT INTO iam.auth_sessions(device_id, expires_at) SELECT d.id, $3 FROM iam.devices d WHERE d.id = $1::uuid AND d.principal_id = $2::uuid AND d.revoked_at IS NULL RETURNING id::text`, deviceID, principalID, expiresAt).Scan(&sessionID)
	if err != nil {
		return "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO iam.refresh_tokens(token_hash, auth_session_id, expires_at) VALUES (decode($1, 'hex'), $2::uuid, $3)`, refreshHash, sessionID, expiresAt); err != nil {
		return "", err
	}
	return sessionID, tx.Commit(ctx)
}

func (r *PgIdentityRepo) RotateRefreshToken(ctx context.Context, oldHash, newHash, _, _, _ string, _ time.Time) (models.User, string, error) {
	return r.rotateRefreshToken(ctx, oldHash, newHash, false)
}

func (r *PgIdentityRepo) RotateLegacyRefreshToken(ctx context.Context, oldHash, newHash, _, _, _ string, _ time.Time) (models.User, string, error) {
	return r.rotateRefreshToken(ctx, oldHash, newHash, true)
}

func (r *PgIdentityRepo) rotateRefreshToken(ctx context.Context, oldHash, newHash string, legacy bool) (models.User, string, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return models.User{}, "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var principalID, sessionID, deviceID string
	err = tx.QueryRow(ctx, `SELECT d.principal_id::text FROM iam.refresh_tokens rt
			JOIN iam.auth_sessions s ON s.id = rt.auth_session_id
			JOIN iam.devices d ON d.id = s.device_id
			WHERE rt.token_hash = decode($1, 'hex')`, oldHash).Scan(&principalID)
	if err != nil {
		return models.User{}, "", err
	}
	var accountGeneration int64
	err = tx.QueryRow(ctx, `SELECT device_generation FROM iam.accounts
		WHERE principal_id = $1::uuid AND deletion_deadline IS NULL FOR UPDATE`, principalID).Scan(&accountGeneration)
	if err != nil {
		return models.User{}, "", err
	}
	if legacy && accountGeneration != 0 {
		return models.User{}, "", ErrLegacyIssuanceRestricted
	}
	if !legacy && accountGeneration <= 0 {
		return models.User{}, "", pgx.ErrNoRows
	}
	var sessionExpires time.Time
	var consumedAt *time.Time
	err = tx.QueryRow(ctx, `SELECT d.principal_id::text, s.id::text, d.id::text, s.expires_at, rt.consumed_at FROM iam.refresh_tokens rt JOIN iam.auth_sessions s ON s.id = rt.auth_session_id JOIN iam.devices d ON d.id = s.device_id JOIN iam.principals p ON p.id = d.principal_id WHERE rt.token_hash = decode($1, 'hex') FOR UPDATE OF rt, s`, oldHash).Scan(&principalID, &sessionID, &deviceID, &sessionExpires, &consumedAt)
	if err != nil {
		return models.User{}, "", err
	}
	if consumedAt != nil {
		if _, err := tx.Exec(ctx, `WITH revoked AS (
			UPDATE iam.auth_sessions SET revoked_at = NOW() WHERE id = $1::uuid AND revoked_at IS NULL RETURNING id
		) SELECT iam.record_account_operation($2::uuid, 'session_revoked', id),
		         iam.append_account_event($2::uuid, 'session_revoked', jsonb_build_object('session_id', id::text)) FROM revoked`, sessionID, principalID); err != nil {
			return models.User{}, "", err
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return models.User{}, "", commitErr
		}
		return models.User{}, "", ErrRefreshTokenReuse
	}
	var active bool
	var generation int
	if err = tx.QueryRow(ctx, `SELECT s.expires_at > NOW() AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND p.disabled_at IS NULL AND a.deletion_deadline IS NULL AND a.device_generation >= 0 AND rt.expires_at > NOW(), GREATEST(a.device_generation, 1) FROM iam.auth_sessions s JOIN iam.devices d ON d.id = s.device_id JOIN iam.principals p ON p.id = d.principal_id JOIN iam.accounts a ON a.principal_id = p.id JOIN iam.refresh_tokens rt ON rt.auth_session_id = s.id WHERE s.id = $1::uuid AND rt.token_hash = decode($2, 'hex')`, sessionID, oldHash).Scan(&active, &generation); err != nil {
		return models.User{}, "", err
	}
	if !active {
		return models.User{}, "", pgx.ErrNoRows
	}
	if _, err = tx.Exec(ctx, `UPDATE iam.refresh_tokens SET consumed_at = NOW() WHERE token_hash = decode($1, 'hex')`, oldHash); err != nil {
		return models.User{}, "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO iam.refresh_tokens(token_hash, auth_session_id, expires_at) VALUES (decode($1, 'hex'), $2::uuid, $3)`, newHash, sessionID, sessionExpires); err != nil {
		return models.User{}, "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return models.User{}, "", err
	}
	user, err := r.GetProfile(ctx, principalID)
	if err != nil {
		return models.User{}, "", fmt.Errorf("%w: %v", ErrRefreshRotationCommitted, err)
	}
	user.DeviceID = deviceID
	user.AuthVersion = generation
	return user, sessionID, nil
}

func (r *PgIdentityRepo) RevokeAllSessions(ctx context.Context, principalID string) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = tx.Exec(ctx, `SELECT 1 FROM iam.accounts WHERE principal_id = $1::uuid FOR UPDATE`, principalID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `WITH revoked AS (
		UPDATE iam.auth_sessions s SET revoked_at = NOW() FROM iam.devices d
		WHERE d.id = s.device_id AND d.principal_id = $1::uuid AND s.revoked_at IS NULL RETURNING s.id
	) SELECT iam.record_account_operation($1::uuid, 'sessions_revoked', NULL),
	         iam.append_account_event($1::uuid, 'sessions_revoked', '{}'::jsonb)
	  WHERE EXISTS (SELECT 1 FROM revoked)`, principalID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *PgIdentityRepo) RevokeSession(ctx context.Context, principalID, sessionID string) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = tx.Exec(ctx, `SELECT 1 FROM iam.accounts WHERE principal_id = $1::uuid FOR UPDATE`, principalID); err != nil {
		return err
	}
	var owned bool
	err = tx.QueryRow(ctx, `
		WITH revoked AS (
			UPDATE iam.auth_sessions s SET revoked_at = now()
			FROM iam.devices d WHERE s.id = $1::uuid AND d.id = s.device_id
				AND d.principal_id = $2::uuid AND s.revoked_at IS NULL
			RETURNING s.id
		), recorded AS MATERIALIZED (
			SELECT iam.record_account_operation($2::uuid, 'session_revoked', id),
			       iam.append_account_event($2::uuid, 'session_revoked', jsonb_build_object('session_id', id::text))
			FROM revoked
		)
		SELECT EXISTS (SELECT 1 FROM recorded) OR EXISTS (
			SELECT 1 FROM iam.auth_sessions s JOIN iam.devices d ON d.id = s.device_id
			WHERE s.id = $1::uuid AND d.principal_id = $2::uuid
		)`, sessionID, principalID).Scan(&owned)
	if err == nil && !owned {
		return pgx.ErrNoRows
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var ErrSetupRestricted = errors.New("account setup is required")

func (r *PgIdentityRepo) ValidateSession(ctx context.Context, principalID, sessionID, deviceID string, authVersion int) error {
	setup, err := r.ValidateSessionState(ctx, principalID, sessionID, deviceID, authVersion)
	if err == nil && setup {
		return ErrSetupRestricted
	}
	return err
}

func (r *PgIdentityRepo) ValidateSessionState(ctx context.Context, principalID, sessionID, deviceID string, authVersion int) (bool, error) {
	var setup bool
	err := r.Pool.QueryRow(ctx, `
		SELECT a.device_generation > 0 AND a.activated_at IS NULL
		FROM iam.auth_sessions s
		JOIN iam.devices d ON d.id = s.device_id
		JOIN iam.principals p ON p.id = d.principal_id
		JOIN iam.accounts a ON a.principal_id = p.id
		WHERE s.id = $1::uuid AND d.id = $2::uuid AND p.id = $3::uuid
		  AND s.expires_at > NOW() AND s.revoked_at IS NULL
		  AND d.revoked_at IS NULL AND p.disabled_at IS NULL AND a.deletion_deadline IS NULL
		  AND a.device_generation >= 0 AND GREATEST(a.device_generation, 1) = $4
	`, sessionID, deviceID, principalID, authVersion).Scan(&setup)
	if err != nil {
		return false, err
	}
	return setup, nil
}

func (r *PgIdentityRepo) GetAuthorization(ctx context.Context, principalID string) (models.AuthorizationContext, error) {
	user, err := r.GetProfile(ctx, principalID)
	if err != nil {
		return models.AuthorizationContext{}, err
	}
	return models.AuthorizationContext{PrincipalID: user.ID, AccountType: "registered", Status: "active", AuthVersion: 1, Roles: []string{"app_user"}, Permissions: registeredPermissions(), PlanCode: user.PlanCode}, nil
}

func (r *PgIdentityRepo) ListPendingPrompts(context.Context, string) ([]models.ConversionPrompt, error) {
	return []models.ConversionPrompt{}, nil
}

func (r *PgIdentityRepo) RecordPromptAction(context.Context, string, models.PromptActionRequest) error {
	return errors.New("conversion prompts are deferred")
}

func (r *PgIdentityRepo) ListSessions(ctx context.Context, principalID, currentID string) ([]models.AuthSessionSummary, error) {
	rows, err := r.Pool.Query(ctx, `SELECT s.id::text, s.device_id::text, s.issued_at, s.expires_at, s.revoked_at FROM iam.auth_sessions s JOIN iam.devices d ON d.id = s.device_id WHERE d.principal_id = $1::uuid ORDER BY s.issued_at DESC`, principalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]models.AuthSessionSummary, 0)
	for rows.Next() {
		var item models.AuthSessionSummary
		if err := rows.Scan(&item.ID, &item.DeviceID, &item.IssuedAt, &item.ExpiresAt, &item.RevokedAt); err != nil {
			return nil, err
		}
		item.Current = item.ID == currentID
		items = append(items, item)
	}
	return items, rows.Err()
}

func decodeNoiseKey(installation *models.DeviceInstallationRequest) ([]byte, error) {
	if installation == nil || strings.TrimSpace(installation.PublicKey) == "" {
		return nil, errors.New("noise static public key is required")
	}
	raw := strings.TrimSpace(installation.PublicKey)
	key, err := base64.RawStdEncoding.DecodeString(raw)
	if err != nil {
		key, err = hex.DecodeString(raw)
	}
	if err != nil || len(key) != 32 {
		return nil, errors.New("noise static public key must encode exactly 32 bytes")
	}
	return key, nil
}

func registeredPermissions() []string {
	return []string{"auth:logout", "profile:read", "sessions:read", "sessions:revoke", "calls:create", "calls:join", "calls:read", "calls:update_state", "calls:signal"}
}
