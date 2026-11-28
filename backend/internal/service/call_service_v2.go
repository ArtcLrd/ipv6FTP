package service

import (
	"context"
	"crypto/hmac"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"ipv6ftp/internal/config"
	appErrors "ipv6ftp/internal/errors"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/repository"
)

const ticketTTL = 30 * time.Second

type CallService struct {
	cfg   config.Config
	calls repository.CallRepo
	cache repository.CacheRepo
}

type signalTicketRecord struct {
	CallID        string `json:"call_id"`
	PrincipalID   string `json:"principal_id"`
	ParticipantID string `json:"participant_id"`
	SessionID     string `json:"session_id"`
	DeviceID      string `json:"device_id"`
	AuthVersion   int    `json:"auth_version"`
}

type DirectTicketRecord struct {
	CallID      string `json:"call_id"`
	PrincipalID string `json:"principal_id"`
	DeviceID    string `json:"device_id"`
	Secret      string `json:"secret"`
}

func NewCallService(cfg config.Config, calls repository.CallRepo, cache repository.CacheRepo) *CallService {
	return &CallService{cfg: cfg, calls: calls, cache: cache}
}

func (s *CallService) CreateInvitation(ctx context.Context, principalID, deviceID string, req models.CallInvitationRequest, _ string) (models.CallInvitation, error) {
	media := strings.ToLower(strings.TrimSpace(req.MediaType))
	if media == "" {
		media = "voice"
	}
	route := strings.ToLower(strings.TrimSpace(req.ConnectionRoute))
	if route == "" {
		route = "direct_ipv6"
	}
	if media != "voice" || route != "direct_ipv6" {
		return models.CallInvitation{}, appErrors.New("only direct IPv6 voice is available", http.StatusBadRequest)
	}
	code, err := randomJoinCode()
	if err != nil {
		return models.CallInvitation{}, err
	}
	invitation, err := s.calls.CreateInvitation(ctx, repository.CreateCallInvitationRequest{PrincipalID: principalID, DeviceID: deviceID, CodeHash: s.hashCode(code), Code: code, MediaType: media, Route: route})
	if err != nil {
		return models.CallInvitation{}, mapCallError(err)
	}
	return invitation, nil
}

func (s *CallService) Join(ctx context.Context, principalID, deviceID string, req models.JoinCallRequest, _ string) (models.JoinCallResponse, error) {
	code := normalizeJoinCode(req.Code)
	if code == "" {
		return models.JoinCallResponse{}, appErrors.New("call code is required", http.StatusBadRequest)
	}
	joined, err := s.calls.AcceptInvitation(ctx, repository.AcceptCallInvitationRequest{PrincipalID: principalID, DeviceID: deviceID, CodeHash: s.hashCode(code)})
	if err != nil {
		return models.JoinCallResponse{}, mapCallError(err)
	}
	return joined, nil
}

func (s *CallService) Accept(ctx context.Context, callID, principalID string) error {
	return s.calls.AcceptParticipant(ctx, callID, principalID)
}

func (s *CallService) Get(ctx context.Context, callID, principalID string) (models.CallSession, error) {
	return s.calls.Get(ctx, callID, principalID)
}

func (s *CallService) SetState(ctx context.Context, callID, principalID, state string) error {
	return s.calls.SetState(ctx, callID, principalID, state)
}

func (s *CallService) Start(ctx context.Context, callID, principalID string) error {
	return s.calls.SetState(ctx, callID, principalID, "active")
}

func (s *CallService) End(ctx context.Context, callID, principalID, reason string) error {
	return s.calls.End(ctx, callID, principalID, reason)
}

func (s *CallService) AuthorizeSignal(ctx context.Context, callID, principalID string) (models.CallSignalAuthorization, error) {
	return s.calls.AuthorizeSignal(ctx, callID, principalID)
}

func (s *CallService) NewSignalTicket(ctx context.Context, callID, principalID, sessionID, deviceID string, authVersion int) (models.CallTicket, error) {
	auth, err := s.calls.AuthorizeSignal(ctx, callID, principalID)
	if err != nil {
		return models.CallTicket{}, mapCallError(err)
	}
	token, err := randomURLToken()
	if err != nil {
		return models.CallTicket{}, err
	}
	expires := time.Now().Add(ticketTTL)
	err = s.cache.Set(ctx, "ipv6ftp:signal-ticket:"+hashOpaqueToken(token), signalTicketRecord{CallID: callID, PrincipalID: principalID, ParticipantID: auth.ParticipantID, SessionID: sessionID, DeviceID: deviceID, AuthVersion: authVersion}, ticketTTL)
	return models.CallTicket{Ticket: token, ExpiresAt: expires}, err
}

func (s *CallService) ConsumeSignalTicket(ctx context.Context, callID, ticket string, validate func(context.Context, string, string, string, int) error) (string, string, error) {
	key := "ipv6ftp:signal-ticket:" + hashOpaqueToken(strings.TrimSpace(ticket))
	raw, ok, err := s.cache.GetString(ctx, key)
	if err != nil || !ok {
		return "", "", appErrors.ErrUnauthorized
	}
	_ = s.cache.Delete(ctx, key)
	var record signalTicketRecord
	if json.Unmarshal([]byte(raw), &record) != nil || record.CallID != callID || record.PrincipalID == "" || record.ParticipantID == "" || record.SessionID == "" || record.DeviceID == "" || validate == nil {
		return "", "", appErrors.ErrUnauthorized
	}
	if err := validate(ctx, record.PrincipalID, record.SessionID, record.DeviceID, record.AuthVersion); err != nil {
		return "", "", err
	}
	auth, err := s.calls.AuthorizeSignal(ctx, callID, record.PrincipalID)
	if err != nil || auth.ParticipantID != record.ParticipantID {
		return "", "", appErrors.ErrUnauthorized
	}
	return record.PrincipalID, record.ParticipantID, nil
}

func (s *CallService) NewDirectTicket(ctx context.Context, callID, principalID, deviceID string) (models.DirectTicket, error) {
	if _, err := s.calls.AuthorizeSignal(ctx, callID, principalID); err != nil {
		return models.DirectTicket{}, mapCallError(err)
	}
	id, err := randomShortToken(16)
	if err != nil {
		return models.DirectTicket{}, err
	}
	secret, err := randomShortToken(32)
	if err != nil {
		return models.DirectTicket{}, err
	}
	expires := time.Now().Add(ticketTTL)
	err = s.cache.Set(ctx, "ipv6ftp:direct-ticket:"+id, DirectTicketRecord{CallID: callID, PrincipalID: principalID, DeviceID: deviceID, Secret: secret}, ticketTTL)
	return models.DirectTicket{TicketID: id, Secret: secret, RendezvousHost: s.cfg.RendezvousPublicHost, RendezvousPort: s.cfg.RendezvousPublicPort, ExpiresAt: expires}, err
}

func (s *CallService) UsageToday(ctx context.Context, principalID string) ([]models.CallUsageToday, error) {
	return s.calls.UsageToday(ctx, principalID)
}

func (s *CallService) hashCode(code string) string {
	mac := hmac.New(sha256.New, []byte(s.cfg.CallCodePepper))
	_, _ = mac.Write([]byte(normalizeJoinCode(code)))
	return hex.EncodeToString(mac.Sum(nil))
}

func randomURLToken() (string, error) { return randomShortToken(32) }

func randomShortToken(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := crand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func randomJoinCode() (string, error) {
	var buf [7]byte
	if _, err := crand.Read(buf[:]); err != nil {
		return "", err
	}
	code := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf[:])[:10]
	code = strings.NewReplacer("O", "8", "I", "9", "L", "7").Replace(code)
	return code[:5] + "-" + code[5:], nil
}

func normalizeJoinCode(value string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(value), "-", ""))
}

func mapCallError(err error) error {
	if err == nil {
		return nil
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "invalid or expired"):
		return appErrors.New("Call invitation is invalid or expired", http.StatusNotFound)
	case strings.Contains(message, "active call"), strings.Contains(message, "duplicate"):
		return appErrors.New("A participant is already in another call", http.StatusConflict)
	case strings.Contains(message, "policy"):
		return appErrors.New("Direct IPv6 voice is not available for this account", http.StatusForbidden)
	default:
		return err
	}
}
