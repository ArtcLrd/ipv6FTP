package httptransport

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"ipv6ftp/internal/transport/http/contracts"
	"ipv6ftp/internal/transport/http/handlers"
)

// Values identify the proof scope field when an additional per-scope limit applies.
var limitedPublicOperations = map[string]string{
	"/api/v1/auth/login":              "username",
	"/api/v1/auth/register":           "username",
	"/api/v1/auth/refresh":            "",
	"/api/v1/auth/check-username":     "",
	"/api/v2/usernames/availability":  "",
	"/api/v2/auth/registered/begin":   "username",
	"/api/v2/auth/setup/resume":       "username",
	"/api/v2/auth/server-key":         "",
	"/api/v2/auth/enroll/challenge":   "",
	"/api/v2/auth/enroll/finish":      "challenge_id",
	"/api/v2/auth/refresh":            "",
	"/api/v2/recovery/begin":          "identifier",
	"/api/v2/recovery/prove":          "recovery_id",
	"/api/v2/recovery/complete":       "recovery_grant",
	"/api/v2/account/deletion/status": "username",
	"/api/v2/account/deletion/cancel": "username",
}

func limitPublicOperations(ipLimit, scopeLimit int, next http.Handler) http.Handler {
	if ipLimit <= 0 {
		ipLimit = 10
	}
	if scopeLimit <= 0 {
		scopeLimit = 5
	}
	var mu sync.Mutex
	counts := make(map[[32]byte]int)
	var window int64
	allow := func(key string, limit int) bool {
		digest := sha256.Sum256([]byte(key))
		mu.Lock()
		defer mu.Unlock()
		now := time.Now().Unix() / 60
		if now != window {
			clear(counts)
			window = now
		}
		count, exists := counts[digest]
		if count >= limit || (!exists && len(counts) >= 32768) {
			return false
		}
		counts[digest] = count + 1
		return true
	}
	reject := func(w http.ResponseWriter) {
		retry := int(60 - time.Now().Unix()%60)
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		handlers.WriteJSON(w, http.StatusTooManyRequests, contracts.ErrorEnvelope{Error: contracts.ErrorBody{
			Code: contracts.CodeRateLimited, Message: "Too many requests",
		}})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		field, limited := limitedPublicOperations[r.URL.Path]
		if !limited {
			next.ServeHTTP(w, r)
			return
		}
		peer, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			peer = r.RemoteAddr
		}
		if !allow(r.URL.Path+"\x00ip\x00"+peer, ipLimit) {
			reject(w)
			return
		}
		if field != "" && r.Method == http.MethodPost && r.Body != nil {
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, contracts.MaxBodyBytes))
			_ = r.Body.Close()
			if err != nil {
				handlers.WriteJSON(w, http.StatusRequestEntityTooLarge, contracts.ErrorEnvelope{Error: contracts.ErrorBody{
					Code: contracts.CodeValidationFailed, Message: "Could not read request body",
				}})
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			var values map[string]json.RawMessage
			var scope string
			if json.Unmarshal(body, &values) == nil && json.Unmarshal(values[field], &scope) == nil {
				scope = strings.TrimSpace(scope)
				if field == "username" || field == "identifier" {
					scope = strings.ToLower(scope)
				}
				if scope != "" && !allow(r.URL.Path+"\x00scope\x00"+scope, scopeLimit) {
					reject(w)
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
