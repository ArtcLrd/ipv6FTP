package handlers

import "net/http"

func WriteJSON(w http.ResponseWriter, status int, value any) { writeJSON(w, status, value) }