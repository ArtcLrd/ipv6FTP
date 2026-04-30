package handlers

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"ipv6ftp/internal/config"
	apperr "ipv6ftp/internal/errors"
	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/rbac"
	"ipv6ftp/internal/realtime"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/security"
	"ipv6ftp/internal/service"
)

var upgrader = websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 1024, CheckOrigin: func(r *http.Request) bool { return true }}

type AuthHandler struct{ cfg config.Config; svc *service.AuthService }
type UserHandler struct{ cfg config.Config; svc *service.UserService; broker *realtime.SSEBroker }
type PhonebookHandler struct{ cfg config.Config; svc *service.PhonebookService }
type RoomHandler struct{ cfg config.Config; hub *realtime.Hub; broker *realtime.SSEBroker; users repository.UserRepo; contacts repository.ContactRepo; cache repository.CacheRepo }

func NewAuthHandler(cfg config.Config, svc *service.AuthService) *AuthHandler { return &AuthHandler{cfg: cfg, svc: svc} }
func NewUserHandler(cfg config.Config, svc *service.UserService, broker *realtime.SSEBroker) *UserHandler { return &UserHandler{cfg: cfg, svc: svc, broker: broker} }
func NewPhonebookHandler(cfg config.Config, svc *service.PhonebookService) *PhonebookHandler { return &PhonebookHandler{cfg: cfg, svc: svc} }
func NewRoomHandler(cfg config.Config, hub *realtime.Hub, broker *realtime.SSEBroker, users repository.UserRepo, contacts repository.ContactRepo, cache repository.CacheRepo) *RoomHandler { return &RoomHandler{cfg: cfg, hub: hub, broker: broker, users: users, contacts: contacts, cache: cache} }

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, err error) {
	if ae, ok := err.(*apperr.AppError); ok {
		http.Error(w, ae.Message, ae.Status)
		return
	}
	http.Error(w, "Internal server error", http.StatusInternalServerError)
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, "Invalid request", http.StatusBadRequest); return }
	user, access, refresh, err := h.svc.Register(r.Context(), req, security.ClientIP(r), r.UserAgent())
	if err != nil { writeError(w, err); return }
	security.SetAuthCookies(w, access, refresh, h.cfg.Environment)
	writeJSON(w, http.StatusOK, user)
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, "Invalid request", http.StatusBadRequest); return }
	user, access, refresh, err := h.svc.Login(r.Context(), req, security.ClientIP(r), r.UserAgent())
	if err != nil { writeError(w, err); return }
	security.SetAuthCookies(w, access, refresh, h.cfg.Environment)
	writeJSON(w, http.StatusOK, user)
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("refresh_token")
	if err != nil { http.Error(w, "Unauthorized", http.StatusUnauthorized); return }
	access, refresh, err := h.svc.Refresh(r.Context(), cookie.Value, r.UserAgent(), security.ClientIP(r))
	if err != nil { writeError(w, err); return }
	security.SetAuthCookies(w, access, refresh, h.cfg.Environment)
	w.WriteHeader(http.StatusOK)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Logout(r.Context(), middleware.ClaimsFromContext(r.Context())); err != nil { writeError(w, err); return }
	security.ClearAuthCookies(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil { http.Error(w, "Unauthorized", http.StatusUnauthorized); return }
	user, err := h.svc.Me(r.Context(), claims.Sub)
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusOK, user)
}

func (h *UserHandler) UpdateIP(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil { http.Error(w, "Unauthorized", http.StatusUnauthorized); return }
	if err := h.svc.UpdateIP(r.Context(), claims.Sub, security.ClientIP(r)); err != nil { writeError(w, err); return }
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) Search(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil { http.Error(w, "Unauthorized", http.StatusUnauthorized); return }
	users, err := h.svc.Search(r.Context(), claims.Sub, r.URL.Query().Get("q"))
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusOK, users)
}

func (h *UserHandler) Contacts(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil { http.Error(w, "Unauthorized", http.StatusUnauthorized); return }
	switch r.Method {
	case http.MethodGet:
		contacts, err := h.svc.ListContacts(r.Context(), claims.Sub)
		if err != nil { writeError(w, err); return }
		writeJSON(w, http.StatusOK, contacts)
	case http.MethodPost:
		var req struct{ ContactID string `json:"contact_id"` }
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, "Invalid request", http.StatusBadRequest); return }
		if err := h.svc.AddContact(r.Context(), claims.Sub, req.ContactID); err != nil { writeError(w, err); return }
		h.svc.PublishContactsUpdated(claims.Sub)
		w.WriteHeader(http.StatusCreated)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *UserHandler) DeleteContact(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete { http.Error(w, "Method not allowed", http.StatusMethodNotAllowed); return }
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil { http.Error(w, "Unauthorized", http.StatusUnauthorized); return }
	contactID := strings.TrimPrefix(r.URL.Path, "/api/contacts/")
	if contactID == "" { http.Error(w, "Missing ID", http.StatusBadRequest); return }
	if err := h.svc.DeleteContact(r.Context(), claims.Sub, contactID); err != nil { writeError(w, err); return }
	h.svc.PublishContactsUpdated(claims.Sub)
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) SSEEvents(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil { http.Error(w, "Unauthorized", http.StatusUnauthorized); return }
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	eventChan, cleanup := h.broker.Subscribe(claims.Sub)
	defer cleanup()
	flusher, ok := w.(http.Flusher)
	if !ok { http.Error(w, "Streaming unsupported", http.StatusInternalServerError); return }
	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case event := <-eventChan:
			data, err := json.Marshal(event)
			if err != nil { continue }
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func (h *PhonebookHandler) Lookup(w http.ResponseWriter, r *http.Request) {
	username := strings.TrimPrefix(r.URL.Path, "/api/v1/phonebook/")
	username = strings.TrimSpace(username)
	if username == "" { http.Error(w, "Missing username", http.StatusBadRequest); return }
	entry, err := h.svc.Lookup(r.Context(), username)
	if err != nil { writeError(w, err); return }
	writeJSON(w, http.StatusOK, entry)
}

func (h *PhonebookHandler) Heartbeat(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil { http.Error(w, "Unauthorized", http.StatusUnauthorized); return }
	var req models.HeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, "Invalid request", http.StatusBadRequest); return }
	if err := h.svc.Heartbeat(r.Context(), claims.Sub, req, security.ClientIP(r)); err != nil { writeError(w, err); return }
	w.WriteHeader(http.StatusNoContent)
}

func (h *RoomHandler) MyIP(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]any{"ip": security.ClientIP(r), "isIPv6": security.IsIPv6(security.ClientIP(r))}) }

func (h *RoomHandler) TURNCredentials(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if h.cfg.MeteredAPIKey != "" {
		appName := h.cfg.MeteredApp
		if appName == "" { appName = "openrelay" }
		domain := h.cfg.MeteredDomain
		if domain == "" { domain = fmt.Sprintf("%s.metered.live", appName) }
		url := fmt.Sprintf("https://%s/api/v1/turn/credentials?apiKey=%s", domain, h.cfg.MeteredAPIKey)
		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Get(url)
		if err != nil || resp.StatusCode != http.StatusOK {
			if resp != nil { _ = resp.Body.Close() }
			url = fmt.Sprintf("https://%s/api/v1/turn/credential?secretKey=%s", domain, h.cfg.MeteredAPIKey)
			resp, err = client.Post(url, "application/json", nil)
		}
		if err == nil && resp != nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()
			var result any
			if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
				switch v := result.(type) {
				case []any:
					writeJSON(w, http.StatusOK, map[string]any{"servers": v}); return
				case map[string]any:
					if servers, ok := v["iceServers"]; ok { writeJSON(w, http.StatusOK, map[string]any{"servers": servers}); return }
					if _, ok := v["urls"]; ok { writeJSON(w, http.StatusOK, map[string]any{"servers": []any{v}}); return }
				}
			}
		}
	}
	if h.cfg.TurnURL == "" { writeJSON(w, http.StatusOK, map[string]any{"servers": []any{}}); return }
	var username, password string
	if h.cfg.TurnSecret != "" {
		expiry := time.Now().Unix() + 3600
		username = fmt.Sprintf("%d:user", expiry)
		mac := hmac.New(sha1.New, []byte(h.cfg.TurnSecret))
		mac.Write([]byte(username))
		password = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	} else {
		username = h.cfg.TurnUsername
		password = h.cfg.TurnCredential
	}
	tcpURL := h.cfg.TurnURL + "?transport=tcp"
	writeJSON(w, http.StatusOK, map[string]any{"servers": []any{map[string]any{"urls": h.cfg.TurnURL, "username": username, "credential": password}, map[string]any{"urls": tcpURL, "username": username, "credential": password}}})
}

func (h *RoomHandler) CreateRoom(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]string{"room_id": generateRoomID()}) }

func (h *RoomHandler) Invite(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil { http.Error(w, "Unauthorized", http.StatusUnauthorized); return }
	var req models.RoomInviteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, "Invalid request", http.StatusBadRequest); return }
	if h.broker != nil { h.broker.Publish(req.ContactID, realtime.Event{Type: req.Type + "-invite", Payload: map[string]string{"from_username": claims.Username, "from_id": claims.Sub, "room_id": req.RoomID}}) }
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *RoomHandler) WebSocket(w http.ResponseWriter, r *http.Request) {
	roomID := strings.TrimSpace(r.URL.Query().Get("room"))
	if roomID == "" { http.Error(w, "missing ?room= parameter", http.StatusBadRequest); return }
	if len(roomID) > 64 { http.Error(w, "room ID too long", http.StatusBadRequest); return }
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil { log.Printf("WebSocket upgrade failed: %v", err); return }
	client := realtime.NewClient(h.hub, roomID, conn)
	h.hub.Join(roomID, client)
	log.Printf("[room:%s] client connected (active: %d)", roomID, h.hub.RoomCount(roomID))
	go client.WritePump()
	go client.ReadPump()
}

func (h *RoomHandler) AdminLockdown(w http.ResponseWriter, r *http.Request) {
	claims := middleware.ClaimsFromContext(r.Context())
	if claims == nil || !rbac.HasPermission(claims.Role, "manage:lockdown") { http.Error(w, "Forbidden", http.StatusForbidden); return }
	var req struct{ Enabled bool `json:"enabled"` }
	_ = json.NewDecoder(r.Body).Decode(&req)
	if h.cache != nil { _ = h.cache.SetBool(r.Context(), "ipv6ftp:lockdown", req.Enabled) }
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": req.Enabled})
}

func generateRoomID() string {
	words := []string{"alpha", "beta", "gamma", "delta", "echo", "foxtrot", "sierra", "tango", "victor", "xray", "zebra", "cobalt", "amber", "jade"}
	word := words[rand.IntN(len(words))]
	hex := fmt.Sprintf("%06x", rand.IntN(0xffffff))
	return fmt.Sprintf("%s-%s", word, hex)
}