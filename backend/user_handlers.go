package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
)

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	IPAddr   string `json:"ip_addr"`
	Status   string `json:"status"`
}

func notifyContacts(broker *SSEBroker, userID string, eventType string) {
	rows, err := DB.Query(`
		SELECT owner_id FROM contacts WHERE contact_id = $1
		UNION
		SELECT contact_id FROM contacts WHERE owner_id = $1`, userID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var contactID string
		if err := rows.Scan(&contactID); err == nil {
			broker.Publish(contactID, Event{
				Type: eventType,
				Payload: map[string]string{
					"user_id": userID,
				},
			})
		}
	}
}

func getReqIP(r *http.Request) string {
	remoteAddr := r.RemoteAddr
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		remoteAddr = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	} else if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
		remoteAddr = realIP
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	return strings.Trim(host, "[]")
}

func registerHandler(broker *SSEBroker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		if len(req.Username) < 3 || len(req.Username) > 30 {
			http.Error(w, "Username must be 3-30 chars", http.StatusBadRequest)
			return
		}
		if len(req.Password) < 8 {
			http.Error(w, "Password must be at least 8 chars", http.StatusBadRequest)
			return
		}

		hash, err := hashPassword(req.Password)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}

		ip := getReqIP(r)
		var user User
		err = DB.QueryRow(
			"INSERT INTO users (username, password_hash, ip_addr, status) VALUES ($1, $2, $3, 'online') RETURNING id, username, ip_addr, status",
			req.Username, hash, ip,
		).Scan(&user.ID, &user.Username, &user.IPAddr, &user.Status)

		if err != nil {
			if strings.Contains(err.Error(), "unique_violation") || strings.Contains(err.Error(), "duplicate key") {
				http.Error(w, "Username taken", http.StatusConflict)
			} else {
				log.Printf("Register error: %v", err)
				http.Error(w, "Server error", http.StatusInternalServerError)
			}
			return
		}

		access, refresh, err := issueTokenPair(user.ID, user.Username)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}

		setAuthCookies(w, access, refresh)
		json.NewEncoder(w).Encode(user)
	}
}

func loginHandler(broker *SSEBroker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		var id, hash, username, status string
		err := DB.QueryRow("SELECT id, username, password_hash, status FROM users WHERE username = $1", req.Username).Scan(&id, &username, &hash, &status)
		if err == sql.ErrNoRows {
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			return
		}
		if err != nil {
			log.Printf("Login DB error: %v", err)
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		if !checkPassword(hash, req.Password) {
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			return
		}

		ip := getReqIP(r)
		_, err = DB.Exec("UPDATE users SET status = 'online', ip_addr = $1, last_seen = NOW() WHERE id = $2", ip, id)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}

		access, refresh, err := issueTokenPair(id, username)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}

		// Notify contacts
		notifyContacts(broker, id, "contact-online")

		setAuthCookies(w, access, refresh)
		json.NewEncoder(w).Encode(User{ID: id, Username: username, IPAddr: ip, Status: "online"})
	}
}

func logoutHandler(broker *SSEBroker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := claimsFromCtx(r.Context())
		if claims != nil {
			DB.Exec("UPDATE users SET status = 'offline' WHERE id = $1", claims.Sub)
			notifyContacts(broker, claims.Sub, "contact-offline")
		}
		clearAuthCookies(w)
		w.WriteHeader(http.StatusNoContent)
	}
}

func refreshHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cookie, err := r.Cookie("refresh_token")
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	claims, err := parseToken(cookie.Value, "refresh")
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	access, refresh, err := issueTokenPair(claims.Sub, claims.Username)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	setAuthCookies(w, access, refresh)
	w.WriteHeader(http.StatusOK)
}

func meHandler(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromCtx(r.Context())
	var user User
	err := DB.QueryRow("SELECT id, username, ip_addr, status FROM users WHERE id = $1", claims.Sub).Scan(&user.ID, &user.Username, &user.IPAddr, &user.Status)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(user)
}

func ipUpdateHandler(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromCtx(r.Context())
	ip := getReqIP(r)
	_, err := DB.Exec("UPDATE users SET ip_addr = $1, last_seen = NOW(), status = 'online' WHERE id = $2", ip, claims.Sub)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func userSearchHandler(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromCtx(r.Context())
	query := r.URL.Query().Get("q")
	if len(query) < 2 {
		json.NewEncoder(w).Encode([]User{})
		return
	}

	rows, err := DB.Query(
		"SELECT id, username, status FROM users WHERE username ILIKE $1 AND id != $2 LIMIT 10",
		fmt.Sprintf("%%%s%%", query), claims.Sub,
	)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Status); err == nil {
			users = append(users, u)
		}
	}
	json.NewEncoder(w).Encode(users)
}
