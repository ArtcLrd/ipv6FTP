package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strconv"
	"time"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/rbac"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/security"
)

type claimsKey struct{}

func ClaimsFromContext(ctx context.Context) *security.TokenClaims {
	claims, _ := ctx.Value(claimsKey{}).(*security.TokenClaims)
	return claims
}

func Auth(cfg config.Config, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("access_token")
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		claims, err := security.ParseToken([]byte(cfg.JWTSecret), cookie.Value, "access")
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, claims)))
	}
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
		if _, ok := allowed["*"]; ok || origin == "" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else if _, ok := allowed[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Credentials", "true")
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