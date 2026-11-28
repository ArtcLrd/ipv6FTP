package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"ipv6ftp/internal/accountpolicy"
	apperr "ipv6ftp/internal/errors"
	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/transport/http/contracts"
)

// AccountSecurityAPI is the service surface the /api/v2 account-security routes need.
type AccountSecurityAPI interface {
	BeginRecovery(ctx context.Context, method, identifier string) (string, error)
	ProveRecovery(ctx context.Context, recoveryID, code string) (string, error)
	CompleteRecovery(ctx context.Context, grant, newPassword string) ([]string, error)
	IssueFreshAuth(ctx context.Context, principalID, password, operation string) (string, int, error)
	RequireFreshAuth(ctx context.Context, principalID, grant, operation string) error
	ChangePassword(ctx context.Context, principalID, grant, newPassword string) error
	RegenerateRecoveryCodes(ctx context.Context, principalID, grant string) ([]string, error)
	AcknowledgeRecoveryCodes(ctx context.Context, principalID, code string) error
	StartEmailVerification(ctx context.Context, principalID, email string) (string, error)
	VerifyEmail(ctx context.Context, principalID, challengeID, code string) error
}

// AccountSecurityHandler serves the v2 account-security contract. A nil API
// (secrets not configured) fails closed with "unavailable".
type AccountSecurityHandler struct {
	api AccountSecurityAPI
	log *slog.Logger
}

func NewAccountSecurityHandler(api AccountSecurityAPI, log *slog.Logger) *AccountSecurityHandler {
	if log == nil {
		log = slog.Default()
	}
	return &AccountSecurityHandler{api: api, log: log}
}

func writeV2(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	// Responses can carry recovery codes or grants; never let a cache keep them.
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if body != nil {
		_ = json.NewEncoder(w).Encode(body)
	}
}

func writeV2Error(w http.ResponseWriter, log *slog.Logger, err error) {
	var ae *apperr.AppError
	if errors.As(err, &ae) && ae.Code != "" && contracts.StatusFor(ae.Code) != http.StatusInternalServerError {
		writeV2(w, contracts.StatusFor(ae.Code), contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: ae.Code, Message: ae.Message}})
		return
	}
	// Never echo internal errors.
	log.Error("account security request failed", "error", err)
	writeV2(w, http.StatusServiceUnavailable, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeUnavailable, Message: "Temporarily unavailable"}})
}

func (h *AccountSecurityHandler) decodeFail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, contracts.ErrMethodNotAllow):
		w.Header().Set("Allow", http.MethodPost)
		writeV2(w, http.StatusMethodNotAllowed, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeValidationFailed, Message: "Method not allowed"}})
	case errors.Is(err, contracts.ErrBodyTooLarge):
		writeV2(w, http.StatusRequestEntityTooLarge, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeValidationFailed, Message: "Request too large"}})
	default:
		// Validation messages can name internal rules; keep the response generic except for password policy.
		msg := "Invalid request"
		if errPasswordPolicy(err) != nil {
			msg = err.Error()
		}
		writeV2(w, http.StatusBadRequest, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeValidationFailed, Message: msg}})
	}
}

var passwordPolicyErrors = []error{
	accountpolicy.ErrPasswordLength, accountpolicy.ErrPasswordBytes,
	accountpolicy.ErrPasswordEncoding, accountpolicy.ErrPasswordCommon,
}

// errPasswordPolicy returns err when it is one of the user-actionable password rules.
func errPasswordPolicy(err error) error {
	for _, e := range passwordPolicyErrors {
		if errors.Is(err, e) {
			return e
		}
	}
	return nil
}

// ready decodes the request and rejects it when the feature is not configured.
func (h *AccountSecurityHandler) ready(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := contracts.Decode(r, http.MethodPost, dst); err != nil {
		h.decodeFail(w, err)
		return false
	}
	if h.api == nil {
		writeV2(w, http.StatusServiceUnavailable, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeUnavailable, Message: "Account recovery is not available"}})
		return false
	}
	return true
}

func principal(r *http.Request) (string, bool) {
	// Must be middleware's accessor: security.ClaimsFromContext reads a different context key.
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil || claims.Sub == "" {
		return "", false
	}
	return claims.Sub, true
}

// ---- unauthenticated recovery ----

func (h *AccountSecurityHandler) RecoveryBegin(w http.ResponseWriter, r *http.Request) {
	var req contracts.RecoveryBeginRequest
	if !h.ready(w, r, &req) {
		return
	}
	id, err := h.api.BeginRecovery(r.Context(), req.Method, req.Identifier)
	if err != nil {
		writeV2Error(w, h.log, err)
		return
	}
	writeV2(w, http.StatusOK, contracts.RecoveryBeginResponse{RecoveryID: id})
}

func (h *AccountSecurityHandler) RecoveryProve(w http.ResponseWriter, r *http.Request) {
	var req contracts.RecoveryProveRequest
	if !h.ready(w, r, &req) {
		return
	}
	grant, err := h.api.ProveRecovery(r.Context(), req.RecoveryID, req.Code)
	if err != nil {
		writeV2Error(w, h.log, err)
		return
	}
	writeV2(w, http.StatusOK, contracts.RecoveryProveResponse{RecoveryGrant: grant})
}

func (h *AccountSecurityHandler) RecoveryComplete(w http.ResponseWriter, r *http.Request) {
	var req contracts.RecoveryCompleteRequest
	if !h.ready(w, r, &req) {
		return
	}
	codes, err := h.api.CompleteRecovery(r.Context(), req.RecoveryGrant, req.NewPassword)
	if err != nil {
		writeV2Error(w, h.log, err)
		return
	}
	writeV2(w, http.StatusOK, contracts.RecoveryCompleteResponse{RecoveryCodes: codes})
}

// ---- authenticated ----

func (h *AccountSecurityHandler) withPrincipal(w http.ResponseWriter, r *http.Request, dst any, fn func(pid string) (any, int, error)) {
	if !h.ready(w, r, dst) {
		return
	}
	pid, ok := principal(r)
	if !ok {
		writeV2(w, http.StatusUnauthorized, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeSessionInvalid, Message: "Sign in required"}})
		return
	}
	body, status, err := fn(pid)
	if err != nil {
		writeV2Error(w, h.log, err)
		return
	}
	writeV2(w, status, body)
}

func (h *AccountSecurityHandler) Reauth(w http.ResponseWriter, r *http.Request) {
	var req contracts.FreshAuthRequest
	h.withPrincipal(w, r, &req, func(pid string) (any, int, error) {
		if middleware.IsSetupSession(r.Context()) && req.Operation != "recovery_codes" {
			return nil, 0, &apperr.AppError{Code: contracts.CodeRestricted, Message: "Complete account setup first"}
		}
		grant, ttl, err := h.api.IssueFreshAuth(r.Context(), pid, req.Password, req.Operation)
		return contracts.FreshAuthResponse{FreshAuthGrant: grant, ExpiresInSeconds: ttl}, http.StatusOK, err
	})
}

func (h *AccountSecurityHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var req contracts.PasswordChangeRequest
	h.withPrincipal(w, r, &req, func(pid string) (any, int, error) {
		return nil, http.StatusNoContent, h.api.ChangePassword(r.Context(), pid, req.FreshAuthGrant, req.NewPassword)
	})
}

func (h *AccountSecurityHandler) RegenerateRecoveryCodes(w http.ResponseWriter, r *http.Request) {
	var req contracts.RecoveryCodesRequest
	h.withPrincipal(w, r, &req, func(pid string) (any, int, error) {
		codes, err := h.api.RegenerateRecoveryCodes(r.Context(), pid, req.FreshAuthGrant)
		return contracts.RecoveryCodesResponse{RecoveryCodes: codes}, http.StatusOK, err
	})
}

func (h *AccountSecurityHandler) AckRecoveryCodes(w http.ResponseWriter, r *http.Request) {
	var req contracts.RecoveryAckRequest
	h.withPrincipal(w, r, &req, func(pid string) (any, int, error) {
		return nil, http.StatusNoContent, h.api.AcknowledgeRecoveryCodes(r.Context(), pid, req.Code)
	})
}

func (h *AccountSecurityHandler) EmailChallenge(w http.ResponseWriter, r *http.Request) {
	var req contracts.EmailChallengeRequest
	h.withPrincipal(w, r, &req, func(pid string) (any, int, error) {
		if err := h.api.RequireFreshAuth(r.Context(), pid, req.FreshAuthGrant, "email_change"); err != nil {
			return nil, 0, err
		}
		id, err := h.api.StartEmailVerification(r.Context(), pid, req.Email)
		return contracts.EmailChallengeResponse{ChallengeID: id}, http.StatusOK, err
	})
}

func (h *AccountSecurityHandler) EmailVerify(w http.ResponseWriter, r *http.Request) {
	var req contracts.EmailVerifyRequest
	h.withPrincipal(w, r, &req, func(pid string) (any, int, error) {
		return nil, http.StatusNoContent, h.api.VerifyEmail(r.Context(), pid, req.ChallengeID, req.Code)
	})
}
