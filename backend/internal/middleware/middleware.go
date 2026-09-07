package middleware

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/rbac"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/security"
)

type claimsKey struct{}

type SessionValidator interface {
	ValidateSession(ctx context.Context, principalID, sessionID, deviceID string, authVersion int) error
}

type AuthorizationProvider interface {
	GetAuthorization(ctx context.Context, principalID string) (models.AuthorizationContext, error)
}

func ClaimsFromContext(ctx context.Context) *security.TokenClaims {
	claims, _ := ctx.Value(claimsKey{}).(*security.TokenClaims)
	return claims
}

func Auth(cfg config.Config, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerTokenFromRequest(r)
		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		claims, err := security.ParseToken([]byte(cfg.JWTSecret), token, "access")
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, claims)))
	}
}

func AuthWithSession(cfg config.Config, validator SessionValidator, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerTokenFromRequest(r)
		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		claims, err := security.ParseToken([]byte(cfg.JWTSecret), token, "access")
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if validator != nil {
			if err := validator.ValidateSession(r.Context(), claims.Sub, claims.SessionID, claims.DeviceID, claims.AuthVersion); err != nil {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, claims)))
	}
}

func AuthWithPermission(cfg config.Config, validator SessionValidator, cache repository.CacheRepo, permission string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerTokenFromRequest(r)
		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		claims, err := security.ParseToken([]byte(cfg.JWTSecret), token, "access")
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if validator != nil {
			if err := validator.ValidateSession(r.Context(), claims.Sub, claims.SessionID, claims.DeviceID, claims.AuthVersion); err != nil {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
		}
		authzProvider, ok := validator.(AuthorizationProvider)
		if !ok || authzProvider == nil {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		authz, err := loadAuthorization(r.Context(), authzProvider, cache, claims.Sub, claims.AuthVersion)
		if err != nil || !hasPermission(authz.Permissions, permission) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, claims)))
	}
}

func bearerTokenFromRequest(r *http.Request) string {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	}
	return strings.TrimSpace(r.URL.Query().Get("access_token"))
}

func loadAuthorization(ctx context.Context, provider AuthorizationProvider, cache repository.CacheRepo, principalID string, authVersion int) (models.AuthorizationContext, error) {
	key := fmt.Sprintf("ipv6ftp:authz:%s:v%d", principalID, authVersion)
	if cache != nil {
		if raw, ok, err := cache.GetString(ctx, key); err == nil && ok && raw != "" {
			var authz models.AuthorizationContext
			if json.Unmarshal([]byte(raw), &authz) == nil && authz.PrincipalID != "" {
				return authz, nil
			}
		}
	}
	authz, err := provider.GetAuthorization(ctx, principalID)
	if err != nil {
		return models.AuthorizationContext{}, err
	}
	if authz.AuthVersion != authVersion || authz.Status != "active" {
		return models.AuthorizationContext{}, fmt.Errorf("authorization context is stale")
	}
	if cache != nil {
		_ = cache.Set(ctx, key, authz, 5*time.Minute)
	}
	return authz, nil
}

func hasPermission(permissions []string, required string) bool {
	if required == "" {
		return true
	}
	for _, permission := range permissions {
		if permission == required || permission == "admin:*" {
			return true
		}
	}
	return false
}

func Recovery(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				if logger != nil {
					logger.Error("panic recovered", "panic", recovered, "stack", string(debug.Stack()))
				}
				http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := r.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, fmt.Errorf("http.Hijacker not implemented")
}

func Logging(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		if logger != nil {
			logger.Info("http request", "method", r.Method, "path", r.URL.Path, "status", recorder.status, "duration", time.Since(started).String())
		}
	})
}

func CORS(cfg config.Config, next http.Handler) http.Handler {
	allowed := map[string]struct{}{}
	for _, origin := range cfg.CORSOrigins {
		allowed[origin] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowCredentials := false
		if _, ok := allowed["*"]; ok || origin == "" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else if _, ok := allowed[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			allowCredentials = true
		}
		if allowCredentials {
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func RateLimit(cfg config.Config, cache repository.CacheRepo, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cache == nil {
			next.ServeHTTP(w, r)
			return
		}
		ip := security.ClientIP(r)
		count, err := cache.Increment(r.Context(), "ipv6ftp:rate:ip:"+ip, time.Minute)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		if count > int64(cfg.RateLimitBurst) {
			http.Error(w, "Too many requests", http.StatusTooManyRequests)
			return
		}
		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(cfg.RateLimitBurst))
		next.ServeHTTP(w, r)
	})
}

func Lockdown(cfg config.Config, cache repository.CacheRepo, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := ClaimsFromContext(r.Context())
		if claims == nil {
			authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
			if strings.HasPrefix(authHeader, "Bearer ") {
				token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
				if token != "" {
					if parsedClaims, err := security.ParseToken([]byte(cfg.JWTSecret), token, "access"); err == nil {
						claims = parsedClaims
					}
				}
			}
		}
		if claims != nil && rbac.HasPermission(claims.Role, "manage:lockdown") {
			next.ServeHTTP(w, r)
			return
		}
		if cache != nil {
			if locked, ok, _ := cache.GetBool(r.Context(), "ipv6ftp:lockdown"); ok && locked {
				http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
