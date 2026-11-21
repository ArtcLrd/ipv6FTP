package handlers

import (
	"context"
	"log/slog"
	"net/http"

	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/transport/http/contracts"
)

// AuthV2API is the service surface of the /api/v2/auth routes.
type AuthV2API interface {
	BeginRegistered(ctx context.Context, username, password string) (contracts.SetupGrantResponse, error)
	ResumeSetup(ctx context.Context, username, password string) (contracts.SetupGrantResponse, error)
	ServerKey(rotation bool) contracts.ServerKeyResponse
	EnrollChallenge(ctx context.Context, setupGrant string, rotation bool) (contracts.EnrollChallengeResponse, error)
	EnrollFinish(ctx context.Context, challengeID, handshake string) (contracts.EnrollFinishResponse, error)
	Activate(ctx context.Context, principalID, sessionID, deviceID string, generation int, operationKey string) error
	Bootstrap(ctx context.Context, principalID, sessionID, deviceID string) (contracts.BootstrapSnapshot, error)
	Refresh(ctx context.Context, refreshToken string) (contracts.RefreshResponse, error)
	Logout(ctx context.Context, principalID, sessionID string) error
}

// AuthV2Handler serves enrollment, activation, bootstrap, refresh and logout.
// A nil API (enrollment secrets not configured) fails closed with "unavailable".
type AuthV2Handler struct {
	api  AuthV2API
	log  *slog.Logger
	base *AccountSecurityHandler
}

func NewAuthV2Handler(api AuthV2API, log *slog.Logger) *AuthV2Handler {
	if log == nil {
		log = slog.Default()
	}
	return &AuthV2Handler{api: api, log: log, base: &AccountSecurityHandler{log: log}}
}

func (h *AuthV2Handler) unavailable(w http.ResponseWriter) {
	writeV2(w, http.StatusServiceUnavailable, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeUnavailable, Message: "Enrollment is not available"}})
}

func (h *AuthV2Handler) post(w http.ResponseWriter, r *http.Request, dst any) bool {
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

func (h *AuthV2Handler) claims(w http.ResponseWriter, r *http.Request) (pid, sid, did string, ok bool) {
	c := middleware.ClaimsFromContext(r.Context())
	if c == nil || c.Sub == "" {
		writeV2(w, http.StatusUnauthorized, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeSessionInvalid, Message: "Sign in required"}})
		return "", "", "", false
	}
	return c.Sub, c.SessionID, c.DeviceID, true
}

func (h *AuthV2Handler) finish(w http.ResponseWriter, status int, body any, err error) {
	if err != nil {
		writeV2Error(w, h.log, err)
		return
	}
	writeV2(w, status, body)
}

func (h *AuthV2Handler) RegisteredBegin(w http.ResponseWriter, r *http.Request) {
	var req contracts.RegisteredBeginRequest
	if !h.post(w, r, &req) {
		return
	}
	out, err := h.api.BeginRegistered(r.Context(), req.Username, req.Password)
	h.finish(w, http.StatusOK, out, err)
}

func (h *AuthV2Handler) SetupResume(w http.ResponseWriter, r *http.Request) {
	var req contracts.SetupResumeRequest
	if !h.post(w, r, &req) {
		return
	}
	out, err := h.api.ResumeSetup(r.Context(), req.Username, req.Password)
	h.finish(w, http.StatusOK, out, err)
}

// ServerKey publishes the enrollment public key and its id for first-use pinning and rotation.
func (h *AuthV2Handler) ServerKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeV2(w, http.StatusMethodNotAllowed, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeValidationFailed, Message: "Method not allowed"}})
		return
	}
	if h.api == nil {
		h.unavailable(w)
		return
	}
	writeV2(w, http.StatusOK, h.api.ServerKey(r.URL.Query().Get("rotation") == "1"))
}

func (h *AuthV2Handler) EnrollChallenge(w http.ResponseWriter, r *http.Request) {
	var req contracts.EnrollChallengeRequest
	if !h.post(w, r, &req) {
		return
	}
	out, err := h.api.EnrollChallenge(r.Context(), req.SetupGrant, req.RotationSupported)
	h.finish(w, http.StatusOK, out, err)
}

func (h *AuthV2Handler) EnrollFinish(w http.ResponseWriter, r *http.Request) {
	var req contracts.EnrollFinishRequest
	if !h.post(w, r, &req) {
		return
	}
	out, err := h.api.EnrollFinish(r.Context(), req.ChallengeID, req.Handshake)
	h.finish(w, http.StatusOK, out, err)
}

func (h *AuthV2Handler) Activate(w http.ResponseWriter, r *http.Request) {
	var req contracts.EmptyRequest
	if !h.post(w, r, &req) {
		return
	}
	pid, sid, did, ok := h.claims(w, r)
	if !ok {
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())
	key := r.Header.Get("Idempotency-Key")
	if len(key) > 128 {
		writeV2(w, http.StatusBadRequest, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeValidationFailed, Message: "Invalid idempotency key"}})
		return
	}
	h.finish(w, http.StatusNoContent, nil, h.api.Activate(r.Context(), pid, sid, did, claims.AuthVersion, key))
}

func (h *AuthV2Handler) Bootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeV2(w, http.StatusMethodNotAllowed, contracts.ErrorEnvelope{Error: contracts.ErrorBody{Code: contracts.CodeValidationFailed, Message: "Method not allowed"}})
		return
	}
	if h.api == nil {
		h.unavailable(w)
		return
	}
	pid, sid, did, ok := h.claims(w, r)
	if !ok {
		return
	}
	snap, err := h.api.Bootstrap(r.Context(), pid, sid, did)
	if r.URL.Query().Get("snapshot") != "extended" {
		snap.Eligibility, snap.ResetAt, snap.Reminder, snap.DeletionDeadline, snap.EventCursor = nil, nil, nil, nil, nil
	}
	if r.URL.Query().Get("include") != "device_key_fingerprint" {
		snap.DeviceKeyFingerprint = ""
	}
	h.finish(w, http.StatusOK, snap, err)
}

func (h *AuthV2Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req contracts.RefreshRequest
	if !h.post(w, r, &req) {
		return
	}
	out, err := h.api.Refresh(r.Context(), req.RefreshToken)
	h.finish(w, http.StatusOK, out, err)
}

func (h *AuthV2Handler) Logout(w http.ResponseWriter, r *http.Request) {
	var req contracts.EmptyRequest
	if !h.post(w, r, &req) {
		return
	}
	pid, sid, _, ok := h.claims(w, r)
	if !ok {
		return
	}
	h.finish(w, http.StatusNoContent, nil, h.api.Logout(r.Context(), pid, sid))
}
