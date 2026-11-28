package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"ipv6ftp/internal/middleware"
)

// AccountEvents delivers recipient-scoped invalidations from the transactional event log.
type AccountEvents struct {
	pool      *pgxpool.Pool
	validator middleware.SessionValidator
	slots     chan struct{}
}

func NewAccountEvents(pool *pgxpool.Pool, validator middleware.SessionValidator) *AccountEvents {
	return &AccountEvents{pool: pool, validator: validator, slots: make(chan struct{}, 500)}
}

func (h *AccountEvents) Ticket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims := middleware.ClaimsFromContext(r.Context())
	if h.pool == nil || h.validator == nil {
		http.Error(w, "Unavailable", http.StatusServiceUnavailable)
		return
	}
	if claims == nil || claims.AuthVersion <= 0 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		http.Error(w, "Unavailable", http.StatusServiceUnavailable)
		return
	}
	hash := sha256.Sum256(raw[:])
	_, err := h.pool.Exec(r.Context(), `INSERT INTO iam.account_event_tickets(token_hash, principal_id, session_id, device_id, auth_version, expires_at) VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5,NOW()+interval '30 seconds') ON CONFLICT (session_id) DO UPDATE SET token_hash=EXCLUDED.token_hash, principal_id=EXCLUDED.principal_id, device_id=EXCLUDED.device_id, auth_version=EXCLUDED.auth_version, expires_at=EXCLUDED.expires_at`, hash[:], claims.Sub, claims.SessionID, claims.DeviceID, claims.AuthVersion)
	if err != nil {
		http.Error(w, "Unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"ticket": base64.RawURLEncoding.EncodeToString(raw[:]), "expires_in_seconds": 30})
}

type accountEvent struct {
	Sequence string          `json:"cursor"`
	Previous string          `json:"previous_cursor"`
	Type     string          `json:"type"`
	Version  int             `json:"version"`
	Payload  json.RawMessage `json:"payload"`
}

func parseEventCursor(value string) (int64, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(decoded) != 8 || base64.RawURLEncoding.EncodeToString(decoded) != value || binary.BigEndian.Uint64(decoded) > uint64(^uint64(0)>>1) {
		return 0, errors.New("invalid cursor")
	}
	return int64(binary.BigEndian.Uint64(decoded)), nil
}

func encodeEventCursor(value int64) string {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], uint64(value))
	return base64.RawURLEncoding.EncodeToString(b[:])
}

// A stream may resume only through a contiguous, unexpired, bounded event.
func accountEventNeedsResync(expected, sequence int64, retained bool, payloadBytes int) bool {
	return !retained || sequence != expected || payloadBytes > 4096
}

func (h *AccountEvents) Stream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.pool == nil || h.validator == nil {
		http.Error(w, "Unavailable", http.StatusServiceUnavailable)
		return
	}
	cursor, err := parseEventCursor(r.URL.Query().Get("cursor"))
	var encoded string
	for _, protocol := range websocket.Subprotocols(r) {
		if strings.HasPrefix(protocol, "ticket.") {
			if encoded != "" {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}
			encoded = strings.TrimPrefix(protocol, "ticket.")
		}
	}
	token, decodeErr := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || decodeErr != nil || len(token) != 32 {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	default:
		http.Error(w, "Unavailable", http.StatusServiceUnavailable)
		return
	}
	hash := sha256.Sum256(token)
	var principal, session, device string
	var generation int
	err = h.pool.QueryRow(r.Context(), `DELETE FROM iam.account_event_tickets WHERE token_hash=$1 AND expires_at>NOW() RETURNING principal_id::text,session_id::text,device_id::text,auth_version`, hash[:]).Scan(&principal, &session, &device, &generation)
	if err != nil || h.validator.ValidateSession(r.Context(), principal, session, device, generation) != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	upgrader := websocket.Upgrader{HandshakeTimeout: 5 * time.Second, Subprotocols: []string{"account-events-v1"}}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(256)
	done := make(chan struct{})
	go func() {
		defer close(done)
		// The stream is server-to-client only. Any data frame terminates it.
		_, _, _ = conn.ReadMessage()
	}()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	deadline := time.NewTimer(5 * time.Minute)
	defer deadline.Stop()
	for {
		if h.validator.ValidateSession(r.Context(), principal, session, device, generation) != nil {
			return
		}
		var high int64
		err = h.pool.QueryRow(r.Context(), `SELECT COALESCE((SELECT last_sequence FROM iam.account_event_sequences WHERE principal_id=$1::uuid),0)`, principal).Scan(&high)
		if err != nil {
			return
		}
		if cursor > high {
			h.writeResync(conn)
			return
		}
		rows, err := h.pool.Query(r.Context(), `SELECT sequence,event_type,version,payload,expires_at > NOW() FROM iam.account_events WHERE principal_id=$1::uuid AND sequence>$2 ORDER BY sequence LIMIT 100`, principal, cursor)
		if err != nil {
			return
		}
		batch := make([]accountEvent, 0, 100)
		gap := false
		expected := cursor + 1
		for rows.Next() {
			var seq int64
			var event accountEvent
			var valid bool
			if err = rows.Scan(&seq, &event.Type, &event.Version, &event.Payload, &valid); err != nil {
				break
			}
			if accountEventNeedsResync(expected, seq, valid, len(event.Payload)) {
				gap = true
				break
			}
			event.Sequence = encodeEventCursor(seq)
			event.Previous = encodeEventCursor(seq - 1)
			batch = append(batch, event)
			expected++
		}
		if rows.Err() != nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			return
		}
		if gap || (len(batch) == 0 && cursor < high) {
			h.writeResync(conn)
			return
		}
		for _, event := range batch {
			if h.validator.ValidateSession(r.Context(), principal, session, device, generation) != nil {
				return
			}
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err = conn.WriteJSON(map[string]any{"kind": "event", "event": event}); err != nil {
				return
			}
			cursor, _ = parseEventCursor(event.Sequence)
		}
		select {
		case <-done:
			return
		case <-r.Context().Done():
			return
		case <-deadline.C:
			return
		case <-ticker.C:
		}
	}
}
func (h *AccountEvents) writeResync(conn *websocket.Conn) {
	conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_ = conn.WriteJSON(map[string]string{"kind": "resync_required"})
}
