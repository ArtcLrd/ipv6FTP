package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/realtime"
	"ipv6ftp/internal/security"
	"ipv6ftp/internal/service"
)

type CallHandler struct {
	cfg       config.Config
	svc       *service.CallService
	signals   *realtime.CallSignalHub
	validator middleware.SessionValidator
}

func NewCallHandler(cfg config.Config, svc *service.CallService, signals *realtime.CallSignalHub, validator middleware.SessionValidator) *CallHandler {
	return &CallHandler{cfg: cfg, svc: svc, signals: signals, validator: validator}
}

func (h *CallHandler) CreateInvitation(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req models.CallInvitationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	invitation, err := h.svc.CreateInvitation(r.Context(), claims.Sub, claims.DeviceID, req, security.ClientIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, invitation)
}

func (h *CallHandler) Join(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req models.JoinCallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	joined, err := h.svc.Join(r.Context(), claims.Sub, claims.DeviceID, req, security.ClientIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, joined)
}

func (h *CallHandler) Start(w http.ResponseWriter, r *http.Request) {
	h.updateCallState(w, r, "start")
}

func (h *CallHandler) End(w http.ResponseWriter, r *http.Request) {
	h.updateCallState(w, r, "end")
}

func (h *CallHandler) UsageToday(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	usage, err := h.svc.UsageToday(r.Context(), claims.Sub)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, usage)
}

func (h *CallHandler) WebSocket(w http.ResponseWriter, r *http.Request) {
	callID, ok := callIDFromPath(r.URL.Path, "signal")
	if !ok {
		http.Error(w, "Missing call session ID", http.StatusBadRequest)
		return
	}
	token := strings.TrimSpace(r.URL.Query().Get("access_token"))
	if token == "" {
		token = strings.TrimSpace(r.URL.Query().Get("token"))
	}
	claims, err := security.ParseToken([]byte(h.cfg.JWTSecret), token, "access")
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if h.validator != nil {
		if err := h.validator.ValidateSession(r.Context(), claims.Sub, claims.SessionID, claims.DeviceID, claims.AuthVersion); err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}
	auth, err := h.svc.AuthorizeSignal(r.Context(), callID, claims.Sub)
	if err != nil {
		writeError(w, err)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := realtime.NewSignalClient(h.signals, auth.CallSessionID, claims.Sub, auth.ParticipantID, conn)
	if err := h.signals.Join(r.Context(), client); err != nil {
		_ = conn.Close()
		writeError(w, err)
		return
	}
	go client.WritePump()
	go client.ReadPump()
}

func (h *CallHandler) updateCallState(w http.ResponseWriter, r *http.Request, action string) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	callID, ok := callIDFromPath(r.URL.Path, action)
	if !ok {
		http.Error(w, "Missing call session ID", http.StatusBadRequest)
		return
	}
	if action == "start" {
		if err := h.svc.Start(r.Context(), callID, claims.Sub); err != nil {
			writeError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	reason := "normal"
	var req struct {
		Reason string `json:"reason"`
	}
	if r.Body != nil && json.NewDecoder(r.Body).Decode(&req) == nil && strings.TrimSpace(req.Reason) != "" {
		reason = strings.TrimSpace(req.Reason)
	}
	if err := h.svc.End(r.Context(), callID, claims.Sub, reason); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func callIDFromPath(path, action string) (string, bool) {
	prefix := "/api/v1/calls/"
	suffix := "/" + action
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	return strings.TrimSpace(id), strings.TrimSpace(id) != ""
}
