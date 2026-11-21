package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

type eventTestSession struct{ principal, session, device string }
type eventTestValidator struct{ allowed map[string]eventTestSession }

func (v eventTestValidator) ValidateSession(_ context.Context, principal, session, device string, generation int) error {
	s, ok := v.allowed[session]
	if !ok || s.principal != principal || s.device != device || generation != 1 {
		return errors.New("invalid session")
	}
	return nil
}

// This test writes test principals and events: run only on an explicitly authorized disposable target.
func TestPostgresEventStreamIsolationReplayAndExpiry(t *testing.T) {
	dsn := os.Getenv("IPV6FTP_ISOLATED_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set IPV6FTP_ISOLATED_TEST_DATABASE_URL to an authorized disposable target")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	sessions := make([]eventTestSession, 0, 2)
	defer func() {
		for _, s := range sessions {
			if _, err := pool.Exec(context.Background(), `DELETE FROM iam.principals WHERE id=$1::uuid`, s.principal); err != nil {
				t.Error(err)
			}
		}
	}()
	for i := 0; i < 2; i++ {
		var s eventTestSession
		var key [32]byte
		if _, err = rand.Read(key[:]); err != nil {
			t.Fatal(err)
		}
		if err = pool.QueryRow(ctx, `INSERT INTO iam.principals DEFAULT VALUES RETURNING id::text`).Scan(&s.principal); err != nil {
			t.Fatal(err)
		}
		sessions = append(sessions, s)
		if err = pool.QueryRow(ctx, `INSERT INTO iam.devices(principal_id,noise_static_public_key) VALUES($1::uuid,$2) RETURNING id::text`, s.principal, key[:]).Scan(&s.device); err != nil {
			t.Fatal(err)
		}
		if err = pool.QueryRow(ctx, `INSERT INTO iam.auth_sessions(device_id,expires_at) VALUES($1::uuid,NOW()+interval '1 hour') RETURNING id::text`, s.device).Scan(&s.session); err != nil {
			t.Fatal(err)
		}
		sessions[len(sessions)-1] = s
	}
	validator := eventTestValidator{allowed: map[string]eventTestSession{sessions[0].session: sessions[0], sessions[1].session: sessions[1]}}
	server := httptest.NewServer(http.HandlerFunc(NewAccountEvents(pool, validator).Stream))
	defer server.Close()
	issue := func(s eventTestSession) string {
		t.Helper()
		var raw [32]byte
		if _, err := rand.Read(raw[:]); err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256(raw[:])
		_, err := pool.Exec(ctx, `INSERT INTO iam.account_event_tickets(token_hash,principal_id,session_id,device_id,auth_version,expires_at) VALUES($1,$2::uuid,$3::uuid,$4::uuid,1,NOW()+interval '30 seconds')`, hash[:], s.principal, s.session, s.device)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(raw[:])
	}
	dial := func(ticket string) (*websocket.Conn, *http.Response, error) {
		t.Helper()
		d := websocket.Dialer{Subprotocols: []string{"account-events-v1", "ticket." + ticket}, HandshakeTimeout: 5 * time.Second}
		return d.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?cursor="+encodeEventCursor(0), nil)
	}
	if _, err = pool.Exec(ctx, `SELECT iam.append_account_event($1::uuid,'owner_event','{}'::jsonb),iam.append_account_event($2::uuid,'other_event','{}'::jsonb)`, sessions[0].principal, sessions[1].principal); err != nil {
		t.Fatal(err)
	}
	ticket := issue(sessions[0])
	conn, response, err := dial(ticket)
	if err != nil {
		t.Fatalf("dial: %v, response: %v", err, response)
	}
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var frame struct {
		Kind  string `json:"kind"`
		Event struct {
			Type string `json:"type"`
		} `json:"event"`
	}
	if err = json.Unmarshal(data, &frame); err != nil || frame.Kind != "event" || frame.Event.Type != "owner_event" {
		t.Fatalf("incorrect recipient event: %s %v", data, err)
	}
	conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, data, err = conn.ReadMessage(); err == nil {
		t.Fatalf("unexpected other-recipient event: %s", data)
	}
	conn.Close()
	reused, response, err := dial(ticket)
	if reused != nil {
		reused.Close()
	}
	if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused ticket accepted: %v %v", response, err)
	}
	if response.Body != nil {
		response.Body.Close()
	}
	if _, err = pool.Exec(ctx, `UPDATE iam.account_events SET expires_at=created_at+interval '1 microsecond' WHERE principal_id=$1::uuid`, sessions[0].principal); err != nil {
		t.Fatal(err)
	}
	ticket = issue(sessions[0])
	conn, response, err = dial(ticket)
	if err != nil {
		t.Fatalf("redial: %v %v", err, response)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err = conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &frame); err != nil || frame.Kind != "resync_required" {
		t.Fatalf("expired cursor: %s %v", data, err)
	}
}
