package repository

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ipv6ftp/internal/models"
)

type IdentityRepo interface {
	BootstrapGuest(ctx context.Context, req models.GuestBootstrapRequest, ipAddr, userAgent string) (models.User, string, error)
	Register(ctx context.Context, req models.RegisterRequest, passwordHash, ipAddr, userAgent string) (models.User, string, error)
	FindPasswordIdentity(ctx context.Context, username string) (PasswordIdentity, error)
	MergeGuest(ctx context.Context, guestPrincipalID, registeredPrincipalID string) error
	GetProfile(ctx context.Context, principalID string) (models.User, error)
	AttachDevice(ctx context.Context, principalID string, installation *models.DeviceInstallationRequest) (string, error)
	CreateAuthSession(ctx context.Context, principalID, deviceInstallationID, refreshHash, refreshHint, userAgent, ipAddr string, expiresAt time.Time) (string, error)
	RotateRefreshToken(ctx context.Context, oldRefreshHash, newRefreshHash, refreshHint, userAgent, ipAddr string, expiresAt time.Time) (models.User, string, error)
	RevokeAllSessions(ctx context.Context, principalID string) error
	RevokeSession(ctx context.Context, principalID, sessionID string) error
	ValidateSession(ctx context.Context, principalID, sessionID, deviceID string, authVersion int) error
	GetAuthorization(ctx context.Context, principalID string) (models.AuthorizationContext, error)
	ListPendingPrompts(ctx context.Context, principalID string) ([]models.ConversionPrompt, error)
	RecordPromptAction(ctx context.Context, principalID string, req models.PromptActionRequest) error
}

type PasswordIdentity struct {
	PrincipalID           string
	Username              string
	AccountType           string
	Status                string
	PasswordHash          string
	DefaultInstallationID string
}

type PgIdentityRepo struct {
	Pool *pgxpool.Pool
}

func NewPgIdentityRepo(pool *pgxpool.Pool) *PgIdentityRepo { return &PgIdentityRepo{Pool: pool} }

func (r *PgIdentityRepo) BootstrapGuest(ctx context.Context, req models.GuestBootstrapRequest, ipAddr, userAgent string) (models.User, string, error) {
	installation := req.Installation
	if strings.TrimSpace(installation.IdentifierHash) == "" {
		return models.User{}, "", errors.New("installation identifier hash is required")
	}

	var user models.User
	var installationID string
	err := r.Pool.QueryRow(ctx, `
		SELECT principal_id::text, device_installation_id::text, COALESCE(username, ''), account_type,
		       role_code, plan_code, trial_expires_at, auth_version
		FROM iam.create_guest_identity($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, '')::inet, NULLIF($6, ''))`,
		installation.IdentifierHash,
		installation.PublicKey,
		platformOrUnknown(installation.Platform),
		installation.AppInstanceID,
		ipAddr,
		userAgent,
	).Scan(&user.ID, &installationID, &user.Username, &user.AccountType, &user.Role, &user.PlanCode, &user.TrialExpires, &user.AuthVersion)
	if err != nil {
		return models.User{}, "", err
	}
	user.DeviceID = installationID
	user.Status = "online"
	if user.Username == "" {
		user.Username = "Guest"
	}
	return user, installationID, nil
}

func (r *PgIdentityRepo) Register(ctx context.Context, req models.RegisterRequest, passwordHash, ipAddr, userAgent string) (models.User, string, error) {
	var guestID any
	if strings.TrimSpace(req.GuestID) != "" {
		guestID = req.GuestID
	}

	var user models.User
	err := r.Pool.QueryRow(ctx, `
		SELECT principal_id::text, username, account_type, role_code, plan_code, trial_expires_at, auth_version
		FROM iam.convert_guest_to_registered($1::uuid, $2::citext, NULLIF($3, '')::citext, $4, NULLIF($5, '')::inet, NULLIF($6, ''))`,
		guestID,
		strings.TrimSpace(req.Username),
		strings.TrimSpace(req.Email),
		passwordHash,
		ipAddr,
		userAgent,
	).Scan(&user.ID, &user.Username, &user.AccountType, &user.Role, &user.PlanCode, &user.TrialExpires, &user.AuthVersion)
	if err != nil {
		return models.User{}, "", err
	}
	user.Status = "online"

	installationID, err := r.AttachDevice(ctx, user.ID, req.Installation)
	if err != nil {
		return models.User{}, "", err
	}
	user.DeviceID = installationID
	return user, installationID, nil
}

func (r *PgIdentityRepo) FindPasswordIdentity(ctx context.Context, username string) (PasswordIdentity, error) {
	var identity PasswordIdentity
	err := r.Pool.QueryRow(ctx, `
		SELECT p.id::text,
		       ua.username::text,
		       ua.account_type,
		       p.status,
		       c.secret_hash,
		       COALESCE((
		           SELECT d.id::text
		           FROM iam.device_installations d
		           WHERE d.principal_id = p.id AND d.revoked_at IS NULL
		           ORDER BY d.last_seen_at DESC
		           LIMIT 1
		       ), '')
		FROM iam.user_accounts ua
		JOIN iam.principals p ON p.id = ua.principal_id
		JOIN iam.auth_credentials c ON c.principal_id = p.id
		WHERE ua.username = $1
		  AND ua.account_type = 'registered'
		  AND p.status = 'active'
		  AND c.credential_type = 'password'
		  AND c.revoked_at IS NULL
		LIMIT 1`, strings.TrimSpace(username)).
		Scan(&identity.PrincipalID, &identity.Username, &identity.AccountType, &identity.Status, &identity.PasswordHash, &identity.DefaultInstallationID)
	return identity, err
}

func (r *PgIdentityRepo) MergeGuest(ctx context.Context, guestPrincipalID, registeredPrincipalID string) error {
	if strings.TrimSpace(guestPrincipalID) == "" || strings.TrimSpace(registeredPrincipalID) == "" || guestPrincipalID == registeredPrincipalID {
		return nil
	}
	_, err := r.Pool.Exec(ctx, `SELECT iam.merge_guest_into_registered($1::uuid, $2::uuid)`, guestPrincipalID, registeredPrincipalID)
	return err
}

func (r *PgIdentityRepo) GetProfile(ctx context.Context, principalID string) (models.User, error) {
	var user models.User
	var capabilities []byte
	var promptsJSON []byte
	err := r.Pool.QueryRow(ctx, `
		SELECT principal_id::text,
		       COALESCE(username, ''),
		       account_type,
		       COALESCE(role_codes, ARRAY[]::TEXT[]),
		       COALESCE(permission_codes, ARRAY[]::TEXT[]),
		       plan_code,
		       principal_status,
		       trial_expires_at,
		       auth_version,
		       COALESCE(capabilities, '{}'::JSONB),
		       api.pending_prompts_json($1::uuid)
		FROM api.user_profiles
		WHERE principal_id = $1::uuid`, principalID).
		Scan(&user.ID, &user.Username, &user.AccountType, &user.Roles, &user.Permissions, &user.PlanCode, &user.Status, &user.TrialExpires, &user.AuthVersion, &capabilities, &promptsJSON)
	if err != nil {
		return models.User{}, err
	}
	if user.Username == "" {
		user.Username = "Guest"
	}
	if len(user.Roles) > 0 {
		user.Role = user.Roles[0]
	} else if user.AccountType == "guest" {
		user.Role = "guest"
	} else {
		user.Role = "app_user"
	}
	if len(capabilities) > 0 {
		_ = json.Unmarshal(capabilities, &user.Capabilities)
	}
	if len(promptsJSON) > 0 {
		_ = json.Unmarshal(promptsJSON, &user.PendingPrompts)
	}
	return user, nil
}

func (r *PgIdentityRepo) AttachDevice(ctx context.Context, principalID string, installation *models.DeviceInstallationRequest) (string, error) {
	if installation == nil || strings.TrimSpace(installation.IdentifierHash) == "" {
		return "", nil
	}
	var installationID string
	err := r.Pool.QueryRow(ctx, `
		SELECT iam.attach_device_to_principal($1::uuid, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''))`,
		principalID,
		installation.IdentifierHash,
		installation.PublicKey,
		platformOrUnknown(installation.Platform),
		installation.AppInstanceID,
	).Scan(&installationID)
	return installationID, err
}

func (r *PgIdentityRepo) CreateAuthSession(ctx context.Context, principalID, deviceInstallationID, refreshHash, refreshHint, userAgent, ipAddr string, expiresAt time.Time) (string, error) {
	var sessionID string
	var deviceID any
	if strings.TrimSpace(deviceInstallationID) != "" {
		deviceID = deviceInstallationID
	}
	err := r.Pool.QueryRow(ctx, `
		SELECT iam.create_auth_session($1::uuid, $2::uuid, $3, $4, NULLIF($5, ''), NULLIF($6, '')::inet, $7)`,
		principalID,
		deviceID,
		refreshHash,
		refreshHint,
		userAgent,
		ipAddr,
		expiresAt,
	).Scan(&sessionID)
	return sessionID, err
}

func (r *PgIdentityRepo) RotateRefreshToken(ctx context.Context, oldRefreshHash, newRefreshHash, refreshHint, userAgent, ipAddr string, expiresAt time.Time) (models.User, string, error) {
	var principalID, sessionID string
	err := r.Pool.QueryRow(ctx, `
		SELECT principal_id::text, session_id::text
		FROM iam.rotate_refresh_token($1, $2, $3, NULLIF($4, ''), NULLIF($5, '')::inet, $6)`,
		oldRefreshHash,
		newRefreshHash,
		refreshHint,
		userAgent,
		ipAddr,
		expiresAt,
	).Scan(&principalID, &sessionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.User{}, "", pgx.ErrNoRows
		}
		return models.User{}, "", err
	}
	user, err := r.GetProfile(ctx, principalID)
	if err != nil {
		return models.User{}, "", err
	}
	_ = r.Pool.QueryRow(ctx, `
		SELECT COALESCE(device_installation_id::text, '')
		FROM iam.auth_sessions
		WHERE id = $1::uuid`, sessionID).
		Scan(&user.DeviceID)
	return user, sessionID, nil
}

func (r *PgIdentityRepo) RevokeAllSessions(ctx context.Context, principalID string) error {
	_, err := r.Pool.Exec(ctx, `SELECT iam.revoke_all_sessions($1::uuid)`, principalID)
	return err
}

func (r *PgIdentityRepo) RevokeSession(ctx context.Context, principalID, sessionID string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	_, err := r.Pool.Exec(ctx, `SELECT iam.revoke_auth_session($1::uuid, $2::uuid)`, principalID, sessionID)
	return err
}

func (r *PgIdentityRepo) ValidateSession(ctx context.Context, principalID, sessionID, deviceID string, authVersion int) error {
	if strings.TrimSpace(sessionID) == "" || authVersion <= 0 {
		return pgx.ErrNoRows
	}
	var device any
	if strings.TrimSpace(deviceID) != "" {
		device = deviceID
	}
	var ignored string
	return r.Pool.QueryRow(ctx, `
		SELECT session_id::text
		FROM iam.validate_auth_session($1::uuid, $2::uuid, $3::uuid, $4)`,
		principalID,
		sessionID,
		device,
		authVersion,
	).Scan(&ignored)
}

func (r *PgIdentityRepo) GetAuthorization(ctx context.Context, principalID string) (models.AuthorizationContext, error) {
	var auth models.AuthorizationContext
	err := r.Pool.QueryRow(ctx, `
		SELECT principal_id::text,
		       account_type,
		       principal_status,
		       auth_version,
		       COALESCE(role_codes, ARRAY[]::TEXT[]),
		       COALESCE(permission_codes, ARRAY[]::TEXT[]),
		       plan_code
		FROM api.user_profiles
		WHERE principal_id = $1::uuid`, principalID).
		Scan(&auth.PrincipalID, &auth.AccountType, &auth.Status, &auth.AuthVersion, &auth.Roles, &auth.Permissions, &auth.PlanCode)
	return auth, err
}

func (r *PgIdentityRepo) ListPendingPrompts(ctx context.Context, principalID string) ([]models.ConversionPrompt, error) {
	var raw []byte
	var prompts []models.ConversionPrompt
	err := r.Pool.QueryRow(ctx, `SELECT api.pending_prompts_json($1::uuid)`, principalID).Scan(&raw)
	if err == nil && len(raw) > 0 {
		err = json.Unmarshal(raw, &prompts)
	}
	if prompts == nil {
		prompts = []models.ConversionPrompt{}
	}
	return prompts, err
}

func (r *PgIdentityRepo) RecordPromptAction(ctx context.Context, principalID string, req models.PromptActionRequest) error {
	action := strings.ToLower(strings.TrimSpace(req.Action))
	switch action {
	case "shown", "snoozed", "dismissed", "signup", "signin":
	default:
		return errors.New("invalid prompt action")
	}
	_, err := r.Pool.Exec(ctx, `SELECT api.record_prompt_action($1::uuid, $2, NULLIF($3, ''), $4)`,
		principalID,
		strings.TrimSpace(req.Code),
		strings.TrimSpace(req.TriggerPeriodKey),
		action,
	)
	return err
}

func platformOrUnknown(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "android", "ios", "web":
		return strings.ToLower(strings.TrimSpace(platform))
	default:
		return "unknown"
	}
}
