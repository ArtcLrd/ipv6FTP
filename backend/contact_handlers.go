package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

func contactsHandler(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromCtx(r.Context())
	if claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		// Symmetric query: show users I added OR who added me
		rows, err := DB.Query(`
			SELECT u.id, u.username, u.status, u.ip_addr,
			       CASE WHEN c.owner_id = $1 THEN 'added_by_me' ELSE 'added_me' END AS direction
			FROM contacts c
			JOIN users u ON u.id = CASE WHEN c.owner_id = $1 THEN c.contact_id ELSE c.owner_id END
			WHERE c.owner_id = $1 OR c.contact_id = $1
			ORDER BY u.status DESC, u.username`, claims.Sub)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type Contact struct {
			User
			Direction string `json:"direction"`
		}
		contacts := []Contact{}
		for rows.Next() {
			var c Contact
			if err := rows.Scan(&c.ID, &c.Username, &c.Status, &c.IPAddr, &c.Direction); err == nil {
				contacts = append(contacts, c)
			}
		}
		json.NewEncoder(w).Encode(contacts)

	case http.MethodPost:
		var req struct {
			ContactID string `json:"contact_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		if req.ContactID == claims.Sub {
			http.Error(w, "Cannot add yourself", http.StatusBadRequest)
			return
		}

		_, err := DB.Exec("INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2)", claims.Sub, req.ContactID)
		if err != nil {
			if strings.Contains(err.Error(), "unique_violation") || strings.Contains(err.Error(), "duplicate key") {
				http.Error(w, "Already a contact", http.StatusConflict)
			} else {
				http.Error(w, "Server error", http.StatusInternalServerError)
			}
			return
		}
		w.WriteHeader(http.StatusCreated)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func contactDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims := claimsFromCtx(r.Context())
	id := strings.TrimPrefix(r.URL.Path, "/api/contacts/")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}

	// Only delete where I am the owner
	res, err := DB.Exec("DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2", claims.Sub, id)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
