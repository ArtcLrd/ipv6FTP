package repository

import (
	"context"
	"database/sql"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"ipv6ftp/internal/models"
)

type CallRepo interface {
	CreateInvitation(ctx context.Context, req CreateCallInvitationRequest) (models.CallInvitation, error)
	AcceptInvitation(ctx context.Context, req AcceptCallInvitationRequest) (models.JoinCallResponse, error)
	Start(ctx context.Context, callSessionID, principalID string) error
	End(ctx context.Context, callSessionID, principalID, reason string) error
	AuthorizeSignal(ctx context.Context, callSessionID, principalID string) (models.CallSignalAuthorization, error)
	UsageToday(ctx context.Context, principalID string) ([]models.CallUsageToday, error)
}

type CreateCallInvitationRequest struct {
	PrincipalID      string
	DeviceID         string
	LinkTokenHash    string
	FallbackCodeHash string
	FallbackCodeHint string
	MediaType        string
	NetworkFamily    string
	ObservedIP       string
}

type AcceptCallInvitationRequest struct {
	PrincipalID string
	DeviceID    string
	TokenHash   string
	ObservedIP  string
}

type PgCallRepo struct{ Pool *pgxpool.Pool }

func NewPgCallRepo(pool *pgxpool.Pool) *PgCallRepo { return &PgCallRepo{Pool: pool} }

func (r *PgCallRepo) CreateInvitation(ctx context.Context, req CreateCallInvitationRequest) (models.CallInvitation, error) {
	var invitation models.CallInvitation
	var allowed sql.NullInt64
	err := r.Pool.QueryRow(ctx, `
		SELECT call_session_id::text,
		       participant_id::text,
		       invitation_id::text,
		       policy_mode,
		       allowed_seconds,
		       expires_at
		FROM api.create_call_invitation(
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$5,
			$6,
			$7,
			NULLIF($8, '')::inet
		)`,
		req.PrincipalID,
		nullableUUID(req.DeviceID),
		req.LinkTokenHash,
		req.FallbackCodeHash,
		req.FallbackCodeHint,
		mediaOrVoice(req.MediaType),
		networkOrIPv6(req.NetworkFamily),
		req.ObservedIP,
	).Scan(&invitation.CallSessionID, &invitation.ParticipantID, &invitation.InvitationID, &invitation.PolicyMode, &allowed, &invitation.ExpiresAt)
	if err != nil {
		return models.CallInvitation{}, err
	}
	if allowed.Valid {
		value := int(allowed.Int64)
		invitation.AllowedSeconds = &value
	}
	return invitation, nil
}

func (r *PgCallRepo) AcceptInvitation(ctx context.Context, req AcceptCallInvitationRequest) (models.JoinCallResponse, error) {
	var joined models.JoinCallResponse
	var allowed sql.NullInt64
	err := r.Pool.QueryRow(ctx, `
		SELECT call_session_id::text,
		       participant_id::text,
		       media_type,
		       network_family,
		       policy_mode,
		       allowed_seconds
		FROM api.accept_call_invitation($1::uuid, $2::uuid, $3, NULLIF($4, '')::inet)`,
		req.PrincipalID,
		nullableUUID(req.DeviceID),
		req.TokenHash,
		req.ObservedIP,
	).Scan(&joined.CallSessionID, &joined.ParticipantID, &joined.MediaType, &joined.NetworkFamily, &joined.PolicyMode, &allowed)
	if err != nil {
		return models.JoinCallResponse{}, err
	}
	if allowed.Valid {
		value := int(allowed.Int64)
		joined.AllowedSeconds = &value
	}
	return joined, nil
}

func (r *PgCallRepo) Start(ctx context.Context, callSessionID, principalID string) error {
	_, err := r.Pool.Exec(ctx, `SELECT api.start_call_session($1::uuid, $2::uuid)`, callSessionID, principalID)
	return err
}

func (r *PgCallRepo) End(ctx context.Context, callSessionID, principalID, reason string) error {
	_, err := r.Pool.Exec(ctx, `SELECT api.end_call_session($1::uuid, $2::uuid, NULLIF($3, ''))`, callSessionID, principalID, reason)
	return err
}

func (r *PgCallRepo) AuthorizeSignal(ctx context.Context, callSessionID, principalID string) (models.CallSignalAuthorization, error) {
	var auth models.CallSignalAuthorization
	var allowed sql.NullInt64
	err := r.Pool.QueryRow(ctx, `
		SELECT call_session_id::text,
		       participant_id::text,
		       media_type,
		       network_family,
		       call_status,
		       allowed_seconds
		FROM api.authorize_call_signal($1::uuid, $2::uuid)`,
		callSessionID,
		principalID,
	).Scan(&auth.CallSessionID, &auth.ParticipantID, &auth.MediaType, &auth.NetworkFamily, &auth.CallStatus, &allowed)
	if err != nil {
		return models.CallSignalAuthorization{}, err
	}
	if allowed.Valid {
		value := int(allowed.Int64)
		auth.AllowedSeconds = &value
	}
	return auth, nil
}

func (r *PgCallRepo) UsageToday(ctx context.Context, principalID string) ([]models.CallUsageToday, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT media_type, network_family, duration_seconds
		FROM api.get_call_usage_today($1::uuid)
		ORDER BY media_type, network_family`, principalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usage := make([]models.CallUsageToday, 0)
	for rows.Next() {
		var row models.CallUsageToday
		if err := rows.Scan(&row.MediaType, &row.NetworkFamily, &row.DurationSeconds); err != nil {
			return nil, err
		}
		if row.NetworkFamily == "ipv6" {
			remaining := int64(3600) - row.DurationSeconds
			if remaining < 0 {
				remaining = 0
			}
			row.RemainingSeconds = &remaining
		}
		usage = append(usage, row)
	}
	return usage, rows.Err()
}

func nullableUUID(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func mediaOrVoice(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "video") {
		return "video"
	}
	return "voice"
}

func networkOrIPv6(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "ipv4") {
		return "ipv4"
	}
	return "ipv6"
}
