package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ipv6ftp/internal/models"
)

type CallRepo interface {
	CreateInvitation(context.Context, CreateCallInvitationRequest) (models.CallInvitation, error)
	AcceptInvitation(context.Context, AcceptCallInvitationRequest) (models.JoinCallResponse, error)
	AcceptParticipant(context.Context, string, string) error
	Get(context.Context, string, string) (models.CallSession, error)
	SetState(context.Context, string, string, string) error
	End(context.Context, string, string, string) error
	AuthorizeSignal(context.Context, string, string) (models.CallSignalAuthorization, error)
	UsageToday(context.Context, string) ([]models.CallUsageToday, error)
}

type CreateCallInvitationRequest struct {
	PrincipalID string
	DeviceID    string
	CodeHash    string
	Code        string
	MediaType   string
	Route       string
}

type AcceptCallInvitationRequest struct {
	PrincipalID string
	DeviceID    string
	CodeHash    string
}

type PgCallRepo struct{ Pool *pgxpool.Pool }

func NewPgCallRepo(pool *pgxpool.Pool) *PgCallRepo { return &PgCallRepo{Pool: pool} }

func (r *PgCallRepo) CreateInvitation(ctx context.Context, req CreateCallInvitationRequest) (models.CallInvitation, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return models.CallInvitation{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	policyID, err := currentPolicy(ctx, tx, req.PrincipalID, req.MediaType, req.Route)
	if err != nil {
		return models.CallInvitation{}, err
	}
	if err = verifyDevice(ctx, tx, req.PrincipalID, req.DeviceID); err != nil {
		return models.CallInvitation{}, err
	}
	var callID string
	err = tx.QueryRow(ctx, `INSERT INTO communication.call_sessions(creator_principal_id, media_type, connection_route) VALUES ($1::uuid, $2, $3) RETURNING id::text`, req.PrincipalID, req.MediaType, req.Route).Scan(&callID)
	if err != nil {
		return models.CallInvitation{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO communication.call_participants(call_session_id, principal_id, device_id, call_policy_id, accepted_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, NOW())`, callID, req.PrincipalID, req.DeviceID, policyID); err != nil {
		return models.CallInvitation{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO communication.active_calls(principal_id, call_session_id) VALUES ($1::uuid, $2::uuid)`, req.PrincipalID, callID); err != nil {
		return models.CallInvitation{}, fmt.Errorf("principal already has an active call: %w", err)
	}
	var expiresAt sql.NullTime
	err = tx.QueryRow(ctx, `INSERT INTO communication.call_invitations(call_session_id, code_hash, expires_at) VALUES ($1::uuid, decode($2, 'hex'), NOW() + INTERVAL '10 minutes') RETURNING expires_at`, callID, req.CodeHash).Scan(&expiresAt)
	if err != nil {
		return models.CallInvitation{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return models.CallInvitation{}, err
	}
	return models.CallInvitation{CallSessionID: callID, ParticipantID: req.PrincipalID, InvitationID: callID, FallbackCode: req.Code, PolicyMode: "unlimited", ExpiresAt: &expiresAt.Time}, nil
}

func (r *PgCallRepo) AcceptInvitation(ctx context.Context, req AcceptCallInvitationRequest) (models.JoinCallResponse, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return models.JoinCallResponse{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var callID, creatorID, mediaType, route, state string
	err = tx.QueryRow(ctx, `SELECT cs.id::text, cs.creator_principal_id::text, cs.media_type, cs.connection_route, cs.state FROM communication.call_invitations ci JOIN communication.call_sessions cs ON cs.id = ci.call_session_id WHERE ci.code_hash = decode($1, 'hex') AND ci.expires_at > NOW() FOR UPDATE OF ci, cs`, req.CodeHash).Scan(&callID, &creatorID, &mediaType, &route, &state)
	if err != nil || state != "waiting" {
		return models.JoinCallResponse{}, errors.New("call invitation is invalid or expired")
	}
	if creatorID == req.PrincipalID {
		return models.JoinCallResponse{}, errors.New("creator cannot join their own call")
	}
	if err = verifyDevice(ctx, tx, req.PrincipalID, req.DeviceID); err != nil {
		return models.JoinCallResponse{}, err
	}
	policyID, err := currentPolicy(ctx, tx, req.PrincipalID, mediaType, route)
	if err != nil {
		return models.JoinCallResponse{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO communication.active_calls(principal_id, call_session_id) VALUES ($1::uuid, $2::uuid)`, req.PrincipalID, callID); err != nil {
		return models.JoinCallResponse{}, fmt.Errorf("principal already has an active call: %w", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO communication.call_participants(call_session_id, principal_id, device_id, call_policy_id) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`, callID, req.PrincipalID, req.DeviceID, policyID); err != nil {
		return models.JoinCallResponse{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE communication.call_sessions SET state = 'awaiting_acceptance' WHERE id = $1::uuid`, callID); err != nil {
		return models.JoinCallResponse{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM communication.call_invitations WHERE call_session_id = $1::uuid`, callID); err != nil {
		return models.JoinCallResponse{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return models.JoinCallResponse{}, err
	}
	return models.JoinCallResponse{CallSessionID: callID, ParticipantID: req.PrincipalID, MediaType: mediaType, ConnectionRoute: route, PolicyMode: "unlimited", State: "awaiting_acceptance"}, nil
}

func (r *PgCallRepo) AcceptParticipant(ctx context.Context, callID, principalID string) error {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var creatorID, state string
	err = tx.QueryRow(ctx, `SELECT creator_principal_id::text, state FROM communication.call_sessions WHERE id = $1::uuid FOR UPDATE`, callID).Scan(&creatorID, &state)
	if err != nil || creatorID != principalID || state != "awaiting_acceptance" {
		return errors.New("call cannot be accepted")
	}
	result, err := tx.Exec(ctx, `UPDATE communication.call_participants SET accepted_at = NOW() WHERE call_session_id = $1::uuid AND principal_id <> $2::uuid AND accepted_at IS NULL`, callID, principalID)
	if err != nil || result.RowsAffected() != 1 {
		return errors.New("joining participant is unavailable")
	}
	if _, err = tx.Exec(ctx, `UPDATE communication.call_sessions SET state = 'handshaking', accepted_at = NOW() WHERE id = $1::uuid`, callID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *PgCallRepo) Get(ctx context.Context, callID, principalID string) (models.CallSession, error) {
	var call models.CallSession
	err := r.Pool.QueryRow(ctx, `
		SELECT cs.id::text, cs.creator_principal_id::text, cs.state, cs.media_type, cs.connection_route,
		       cs.created_at, cs.accepted_at, cs.connected_at, cs.ended_at, COALESCE(cs.end_reason, ''),
		       COALESCE(peer.principal_id::text, ''), COALESCE(peer.device_id::text, ''),
		       COALESCE(a.username, ''), COALESCE(encode(d.noise_static_public_key, 'base64'), '')
		FROM communication.call_sessions cs
		JOIN communication.call_participants mine ON mine.call_session_id = cs.id AND mine.principal_id = $2::uuid
		LEFT JOIN communication.call_participants peer ON peer.call_session_id = cs.id AND peer.principal_id <> $2::uuid
		LEFT JOIN iam.accounts a ON a.principal_id = peer.principal_id
		LEFT JOIN iam.devices d ON d.id = peer.device_id
		WHERE cs.id = $1::uuid`, callID, principalID).Scan(
		&call.ID, &call.CreatorPrincipalID, &call.State, &call.MediaType, &call.ConnectionRoute,
		&call.CreatedAt, &call.AcceptedAt, &call.ConnectedAt, &call.EndedAt, &call.EndReason,
		&call.RemotePrincipalID, &call.RemoteDeviceID, &call.RemoteUsername, &call.RemoteNoiseKey,
	)
	return call, err
}

func (r *PgCallRepo) SetState(ctx context.Context, callID, principalID, next string) error {
	allowed := map[string][]string{"verifying": {"handshaking"}, "connecting": {"verifying"}, "active": {"connecting"}}
	from, ok := allowed[next]
	if !ok {
		return errors.New("invalid call state")
	}
	result, err := r.Pool.Exec(ctx, `UPDATE communication.call_sessions cs SET state = $3, connected_at = CASE WHEN $3 = 'active' THEN COALESCE(connected_at, NOW()) ELSE connected_at END WHERE cs.id = $1::uuid AND cs.state = ANY($4) AND EXISTS (SELECT 1 FROM communication.call_participants cp WHERE cp.call_session_id = cs.id AND cp.principal_id = $2::uuid)`, callID, principalID, next, from)
	if err == nil && result.RowsAffected() == 0 {
		return errors.New("call state transition rejected")
	}
	return err
}

func (r *PgCallRepo) End(ctx context.Context, callID, principalID, reason string) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := tx.Exec(ctx, `UPDATE communication.call_sessions cs SET state = 'ended', ended_at = COALESCE(ended_at, NOW()), end_reason = COALESCE(end_reason, NULLIF($3, '')) WHERE cs.id = $1::uuid AND EXISTS (SELECT 1 FROM communication.call_participants cp WHERE cp.call_session_id = cs.id AND cp.principal_id = $2::uuid)`, callID, principalID, strings.TrimSpace(reason))
	if err != nil || result.RowsAffected() == 0 {
		return errors.New("call not found")
	}
	if _, err = tx.Exec(ctx, `DELETE FROM communication.active_calls WHERE call_session_id = $1::uuid`, callID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *PgCallRepo) AuthorizeSignal(ctx context.Context, callID, principalID string) (models.CallSignalAuthorization, error) {
	var auth models.CallSignalAuthorization
	err := r.Pool.QueryRow(ctx, `SELECT cs.id::text, cp.principal_id::text, cs.media_type, cs.connection_route, cs.state FROM communication.call_sessions cs JOIN communication.call_participants cp ON cp.call_session_id = cs.id WHERE cs.id = $1::uuid AND cp.principal_id = $2::uuid AND cs.state IN ('handshaking', 'verifying', 'connecting', 'active')`, callID, principalID).Scan(&auth.CallSessionID, &auth.ParticipantID, &auth.MediaType, &auth.ConnectionRoute, &auth.CallStatus)
	return auth, err
}

func (r *PgCallRepo) UsageToday(ctx context.Context, principalID string) ([]models.CallUsageToday, error) {
	var seconds int64
	err := r.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(cs.ended_at, NOW()) - cs.connected_at)))::bigint, 0) FROM communication.call_sessions cs JOIN communication.call_participants cp ON cp.call_session_id = cs.id WHERE cp.principal_id = $1::uuid AND cs.connected_at >= CURRENT_DATE`, principalID).Scan(&seconds)
	if err != nil {
		return nil, err
	}
	return []models.CallUsageToday{{MediaType: "voice", NetworkFamily: "ipv6", DurationSeconds: seconds}}, nil
}

func currentPolicy(ctx context.Context, tx pgx.Tx, principalID, mediaType, route string) (string, error) {
	var policyID string
	err := tx.QueryRow(ctx, `SELECT cp.id::text FROM catalog.plan_assignments pa JOIN catalog.call_policies cp ON cp.plan_version_id = pa.plan_version_id WHERE pa.principal_id = $1::uuid AND pa.effective_from <= NOW() AND (pa.effective_until IS NULL OR pa.effective_until > NOW()) AND cp.media_type = $2 AND cp.connection_route = $3 ORDER BY pa.effective_from DESC LIMIT 1`, principalID, mediaType, route).Scan(&policyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errors.New("call policy is not available")
	}
	return policyID, err
}

func verifyDevice(ctx context.Context, tx pgx.Tx, principalID, deviceID string) error {
	var ok bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM iam.devices WHERE id = $1::uuid AND principal_id = $2::uuid AND revoked_at IS NULL)`, deviceID, principalID).Scan(&ok)
	if err != nil || !ok {
		return errors.New("device is not authorized")
	}
	return nil
}
