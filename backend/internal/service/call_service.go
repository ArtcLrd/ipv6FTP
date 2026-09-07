package service

import (
	"context"
	crand "crypto/rand"
	"encoding/base32"
	"encoding/base64"
	"net/http"
	"strings"

	"ipv6ftp/internal/config"
	appErrors "ipv6ftp/internal/errors"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/repository"
)

type CallService struct {
	cfg   config.Config
	calls repository.CallRepo
	cache repository.CacheRepo
}

func NewCallService(cfg config.Config, calls repository.CallRepo, cache repository.CacheRepo) *CallService {
	return &CallService{cfg: cfg, calls: calls, cache: cache}
}

func (s *CallService) CreateInvitation(ctx context.Context, principalID, deviceID string, req models.CallInvitationRequest, ipAddr string) (models.CallInvitation, error) {
	token, err := randomURLToken()
	if err != nil {
		return models.CallInvitation{}, err
	}
	code, err := randomJoinCode()
	if err != nil {
		return models.CallInvitation{}, err
	}

	invitation, err := s.calls.CreateInvitation(ctx, repository.CreateCallInvitationRequest{
		PrincipalID:      principalID,
		DeviceID:         deviceID,
		LinkTokenHash:    hashOpaqueToken(token),
		FallbackCodeHash: hashOpaqueToken(normalizeJoinCode(code)),
		FallbackCodeHint: code,
		MediaType:        req.MediaType,
		NetworkFamily:    req.NetworkFamily,
		ObservedIP:       ipAddr,
	})
	if err != nil {
		return models.CallInvitation{}, mapCallError(err)
	}
	invitation.LinkToken = token
	invitation.FallbackCode = code
	if s.cfg.AppLinkBaseURL != "" {
		invitation.JoinURL = s.cfg.AppLinkBaseURL + "/call/" + token
	}
	return invitation, nil
}

func (s *CallService) Join(ctx context.Context, principalID, deviceID string, req models.JoinCallRequest, ipAddr string) (models.JoinCallResponse, error) {
	raw := strings.TrimSpace(req.Token)
	if raw == "" {
		raw = normalizeJoinCode(req.Code)
	}
	if raw == "" {
		return models.JoinCallResponse{}, appErrors.New("code or token is required", http.StatusBadRequest)
	}
	joined, err := s.calls.AcceptInvitation(ctx, repository.AcceptCallInvitationRequest{
		PrincipalID: principalID,
		DeviceID:    deviceID,
		TokenHash:   hashOpaqueToken(raw),
		ObservedIP:  ipAddr,
	})
	if err != nil {
		return models.JoinCallResponse{}, mapCallError(err)
	}
	return joined, nil
}

func (s *CallService) Start(ctx context.Context, callSessionID, principalID string) error {
	if strings.TrimSpace(callSessionID) == "" {
		return appErrors.New("call_session_id is required", http.StatusBadRequest)
	}
	return s.calls.Start(ctx, callSessionID, principalID)
}

func (s *CallService) End(ctx context.Context, callSessionID, principalID, reason string) error {
	if strings.TrimSpace(callSessionID) == "" {
		return appErrors.New("call_session_id is required", http.StatusBadRequest)
	}
	return s.calls.End(ctx, callSessionID, principalID, reason)
}

func (s *CallService) AuthorizeSignal(ctx context.Context, callSessionID, principalID string) (models.CallSignalAuthorization, error) {
	if strings.TrimSpace(callSessionID) == "" {
		return models.CallSignalAuthorization{}, appErrors.New("call_session_id is required", http.StatusBadRequest)
	}
	auth, err := s.calls.AuthorizeSignal(ctx, callSessionID, principalID)
	if err != nil {
		return models.CallSignalAuthorization{}, mapCallError(err)
	}
	return auth, nil
}

func (s *CallService) UsageToday(ctx context.Context, principalID string) ([]models.CallUsageToday, error) {
	return s.calls.UsageToday(ctx, principalID)
}

func randomURLToken() (string, error) {
	var buf [32]byte
	if _, err := crand.Read(buf[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf[:]), nil
}

func randomJoinCode() (string, error) {
	var buf [8]byte
	if _, err := crand.Read(buf[:]); err != nil {
		return "", err
	}
	code := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf[:])
	code = strings.NewReplacer("O", "8", "I", "9", "L", "7").Replace(code)
	if len(code) > 12 {
		code = code[:12]
	}
	return code[:4] + "-" + code[4:8] + "-" + code[8:], nil
}

func normalizeJoinCode(value string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(value), "-", ""))
}

func mapCallError(err error) error {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "quota_exhausted"):
		details := models.CallDeniedDetails{
			ReasonCode:               "quota_exhausted",
			RemainingSeconds:         0,
			EligibleConversionPrompt: extractPipeValue(err.Error(), "prompt"),
			ResetAt:                  extractPipeValue(err.Error(), "reset_at"),
		}
		return appErrors.NewCoded("Call allowance is exhausted", http.StatusForbidden, "quota_exhausted", details)
	case strings.Contains(message, "ipv6"):
		return appErrors.New("Guest calls require a global IPv6 connection", http.StatusForbidden)
	case strings.Contains(message, "exhausted"), strings.Contains(message, "not available"):
		return appErrors.New("Call allowance is not available", http.StatusForbidden)
	case strings.Contains(message, "invalid"):
		return appErrors.New("Call invitation is invalid or expired", http.StatusNotFound)
	case strings.Contains(message, "two active participants"):
		return appErrors.New("Call already has two participants", http.StatusConflict)
	default:
		return err
	}
}

func extractPipeValue(message, key string) string {
	for _, part := range strings.Split(message, "|") {
		part = strings.TrimSpace(part)
		prefix := key + "="
		if strings.HasPrefix(part, prefix) {
			return strings.Trim(strings.TrimPrefix(part, prefix), " ")
		}
	}
	return ""
}
