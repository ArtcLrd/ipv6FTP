package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/realtime"
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

func (h *CallHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil || r.Method != http.MethodPost {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req models.CallInvitationRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	invitation, err := h.svc.CreateInvitation(r.Context(), claims.Sub, claims.DeviceID, req, "")
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, invitation)
}

func (h *CallHandler) Join(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil || r.Method != http.MethodPost {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req models.JoinCallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	joined, err := h.svc.Join(r.Context(), claims.Sub, claims.DeviceID, req, "")
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, joined)
}

func (h *CallHandler) Get(w http.ResponseWriter, r *http.Request, callID string) {
	claims := middleware.ClaimsFromContext(r.Context())
	call, err := h.svc.Get(r.Context(), callID, claims.Sub)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, call)
}

func (h *CallHandler) Accept(w http.ResponseWriter, r *http.Request, callID string) {
	claims := middleware.ClaimsFromContext(r.Context())
	if err := h.svc.Accept(r.Context(), callID, claims.Sub); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CallHandler) SetState(w http.ResponseWriter, r *http.Request, callID string) {
	claims := middleware.ClaimsFromContext(r.Context())
	var req struct {
		State string `json:"state"`
	}
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if err := h.svc.SetState(r.Context(), callID, claims.Sub, strings.TrimSpace(req.State)); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CallHandler) End(w http.ResponseWriter, r *http.Request, callID string) {
	claims := middleware.ClaimsFromContext(r.Context())
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

func (h *CallHandler) SignalTicket(w http.ResponseWriter, r *http.Request, callID string) {
	claims := middleware.ClaimsFromContext(r.Context())
	ticket, err := h.svc.NewSignalTicket(r.Context(), callID, claims.Sub, claims.SessionID, claims.DeviceID, claims.AuthVersion)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ticket)
}

func (h *CallHandler) DirectTicket(w http.ResponseWriter, r *http.Request, callID string) {
	claims := middleware.ClaimsFromContext(r.Context())
	ticket, err := h.svc.NewDirectTicket(r.Context(), callID, claims.Sub, claims.DeviceID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ticket)
}

func (h *CallHandler) WebSocket(w http.ResponseWriter, r *http.Request, callID string) {
	if h.validator == nil {
		http.Error(w, "Authorization unavailable", http.StatusServiceUnavailable)
		return
	}
	principalID, participantID, err := h.svc.ConsumeSignalTicket(r.Context(), callID, r.URL.Query().Get("ticket"), h.validator.ValidateSession)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := realtime.NewSignalClient(h.signals, callID, principalID, participantID, conn)
	if err := h.signals.Join(r.Context(), client); err != nil {
		_ = conn.Close()
		return
	}
	go client.WritePump()
	go client.ReadPump()
}
