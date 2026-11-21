package handlers

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/transport/http/contracts"
)

// AccountLifecycleAPI is the service surface the /api/v2 profile, deletion and session routes need.
type AccountLifecycleAPI interface {
	Profile(ctx context.Context, principalID string) (contracts.ProfileResponse, error)
	UsernameAvailable(ctx context.Context, username string) (bool, error)
	ChangeUsername(ctx context.Context, principalID, grant, username string) error
	RequestDeletion(ctx context.Context, principalID, grant string) (time.Time, error)
	DeletionStatusForCredentials(ctx context.Context, username, password string) (contracts.DeletionStatusResponse, error)
	CancelDeletion(ctx context.Context, username, password string) error
	ListSessions(ctx context.Context, principalID, currentSessionID string) (contracts.SessionsResponse, error)
	RevokeSession(ctx context.Context, principalID, sessionID string) error
	RevokeAllSessions(ctx context.Context, principalID string) error
}

// AccountLifecycleHandler serves the v2 profile/lifecycle contract. A nil API fails closed.
type AccountLifecycleHandler struct {
	api AccountLifecycleAPI
	log *slog.Logger
	// reuse the account-security helpers for envelopes and decoding
	base *AccountSecurityHandler
}

func NewAccountLifecycleHandler(api AccountLifecycleAPI, log *slog.Logger) *AccountLifecycleHandler {
	if log == nil {
		log = slog.Default()
	}
	return &AccountLifecycleHandler{api: api, log: log, base: &AccountSecurityHandler{log: log}}
}

func (h *AccountLifecycleHandler) unavailable(w http.ResponseWriter) {
	writeV2(w, http.StatusServiceUnavailable, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeUnavailable, Message: "Account management is not available"}})
}

// get validates a body-less GET.
func (h *AccountLifecycleHandler) get(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeV2(w, http.StatusMethodNotAllowed, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeValidationFailed, Message: "Method not allowed"}})
		return false
	}
	if h.api == nil {
		h.unavailable(w)
		return false
	}
	return true
}

func (h *AccountLifecycleHandler) post(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := contracts.Decode(r, http.MethodPost, dst); err != nil {
		h.base.decodeFail(w, err)
		return false
	}
	if h.api == nil {
		h.unavailable(w)
		return false
	}
	return true
}

func (h *AccountLifecycleHandler) session(w http.ResponseWriter, r *http.Request) (pid, sid string, ok bool) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil || claims.Sub == "" {
		writeV2(w, http.StatusUnauthorized, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeSessionInvalid, Message: "Sign in required"}})
		return "", "", false
	}
	return claims.Sub, claims.SessionID, true
}

func (h *AccountLifecycleHandler) finish(w http.ResponseWriter, status int, body any, err error) {
	if err != nil {
		writeV2Error(w, h.log, err)
		return
	}
	writeV2(w, status, body)
}

func (h *AccountLifecycleHandler) Profile(w http.ResponseWriter, r *http.Request) {
	if !h.get(w, r) {
		return
	}
	pid, _, ok := h.session(w, r)
	if !ok {
		return
	}
	p, err := h.api.Profile(r.Context(), pid)
	h.finish(w, http.StatusOK, p, err)
}

// UsernameAvailability is public and bounded by the router's rate limiter.
func (h *AccountLifecycleHandler) UsernameAvailability(w http.ResponseWriter, r *http.Request) {
	if !h.get(w, r) {
		return
	}
	ok, err := h.api.UsernameAvailable(r.Context(), r.URL.Query().Get("username"))
	h.finish(w, http.StatusOK, contracts.UsernameAvailabilityResponse{Available: ok}, err)
}

func (h *AccountLifecycleHandler) ChangeUsername(w http.ResponseWriter, r *http.Request) {
	var req contracts.UsernameChangeRequest
	if !h.post(w, r, &req) {
		return
	}
	pid, _, ok := h.session(w, r)
	if !ok {
		return
	}
	h.finish(w, http.StatusNoContent, nil, h.api.ChangeUsername(r.Context(), pid, req.FreshAuthGrant, req.Username))
}

func (h *AccountLifecycleHandler) RequestDeletion(w http.ResponseWriter, r *http.Request) {
	var req contracts.DeletionRequest
	if !h.post(w, r, &req) {
		return
	}
	pid, _, ok := h.session(w, r)
	if !ok {
		return
	}
	deadline, err := h.api.RequestDeletion(r.Context(), pid, req.FreshAuthGrant)
	d := deadline.UTC().Format(time.RFC3339)
	h.finish(w, http.StatusOK, contracts.DeletionStatusResponse{State: "pending_deletion", Deadline: &d}, err)
}

// DeletionStatus is credentialed rather than session-based because requesting deletion revokes every session.
func (h *AccountLifecycleHandler) DeletionStatus(w http.ResponseWriter, r *http.Request) {
	var req contracts.DeletionCancelRequest
	if !h.post(w, r, &req) {
		return
	}
	st, err := h.api.DeletionStatusForCredentials(r.Context(), req.Username, req.Password)
	h.finish(w, http.StatusOK, st, err)
}

func (h *AccountLifecycleHandler) CancelDeletion(w http.ResponseWriter, r *http.Request) {
	var req contracts.DeletionCancelRequest
	if !h.post(w, r, &req) {
		return
	}
	h.finish(w, http.StatusNoContent, nil, h.api.CancelDeletion(r.Context(), req.Username, req.Password))
}

func (h *AccountLifecycleHandler) Sessions(w http.ResponseWriter, r *http.Request) {
	if !h.get(w, r) {
		return
	}
	pid, sid, ok := h.session(w, r)
	if !ok {
		return
	}
	out, err := h.api.ListSessions(r.Context(), pid, sid)
	h.finish(w, http.StatusOK, out, err)
}

func (h *AccountLifecycleHandler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	var req contracts.SessionRevokeRequest
	if !h.post(w, r, &req) {
		return
	}
	pid, _, ok := h.session(w, r)
	if !ok {
		return
	}
	h.finish(w, http.StatusNoContent, nil, h.api.RevokeSession(r.Context(), pid, req.SessionID))
}

func (h *AccountLifecycleHandler) LogoutAll(w http.ResponseWriter, r *http.Request) {
	var req contracts.EmptyRequest
	if !h.post(w, r, &req) {
		return
	}
	pid, _, ok := h.session(w, r)
	if !ok {
		return
	}
	h.finish(w, http.StatusNoContent, nil, h.api.RevokeAllSessions(r.Context(), pid))
}
