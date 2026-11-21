package httptransport

import (
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/realtime"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/service"
	"ipv6ftp/internal/transport/http/handlers"
)

type RouterDeps struct {
	Pool        *pgxpool.Pool
	Config      config.Config
	Logger      *slog.Logger
	Auth        *service.AuthService
	User        *service.UserService
	Phonebook   *service.PhonebookService
	Call        *service.CallService
	Hub         *realtime.Hub
	Signals     *realtime.CallSignalHub
	Broker      *realtime.SSEBroker
	Cache       repository.CacheRepo
	UserRepo    repository.UserRepo
	ContactRepo repository.ContactRepo
	Validator   middleware.SessionValidator
	// AccountSecurity may be nil (secrets not configured); the routes then answer "unavailable".
	AccountSecurity handlers.AccountSecurityAPI
	// AccountLifecycle is nil when account security is not configured; its routes answer "unavailable".
	AccountLifecycle handlers.AccountLifecycleAPI
	// AuthV2 is nil unless NOISE_STATIC_KEY is configured; its routes answer "unavailable".
	AuthV2 handlers.AuthV2API
}

func NewRouter(deps RouterDeps) http.Handler {
	authHandler := handlers.NewAuthHandler(deps.Config, deps.Auth)
	callHandler := handlers.NewCallHandler(deps.Config, deps.Call, deps.Signals, deps.Validator)

	mux := http.NewServeMux()
	authenticated := func(next http.HandlerFunc) http.HandlerFunc {
		return middleware.AuthWithSession(deps.Config, deps.Validator, next)
	}
	setupAllowed := func(next http.HandlerFunc) http.HandlerFunc {
		return middleware.AuthWithSetupSession(deps.Config, deps.Validator, next)
	}
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		handlers.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	legacyIssuance := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if deps.Config.V1CredentialIssuance == "upgrade_required" {
				handlers.WriteJSON(w, http.StatusUpgradeRequired, map[string]any{"error": map[string]string{
					"code": "upgrade_required", "message": "Update the app to continue",
				}})
				return
			}
			next(w, r)
		}
	}
	mux.HandleFunc("/api/v1/auth/register", legacyIssuance(authHandler.Register))
	mux.HandleFunc("/api/v1/auth/login", legacyIssuance(authHandler.Login))
	mux.HandleFunc("/api/v1/auth/check-username", authHandler.CheckUsername)
	mux.HandleFunc("/api/v1/auth/refresh", legacyIssuance(authHandler.Refresh))
	mux.HandleFunc("/api/v1/auth/logout", authenticated(authHandler.Logout))
	mux.HandleFunc("/api/v1/auth/me", authenticated(authHandler.Me))
	mux.HandleFunc("/api/v1/auth/sessions", authenticated(authHandler.Sessions))
	mux.HandleFunc("/api/v1/auth/sessions/", authenticated(authHandler.RevokeSession))
	// v2 account security. Recovery is unauthenticated by design (the user has lost their
	// password); everything else needs a session. See docs/voice-architecture/user-management-contracts-v2.md.
	account := handlers.NewAccountSecurityHandler(deps.AccountSecurity, deps.Logger)
	mux.HandleFunc("/api/v2/recovery/begin", account.RecoveryBegin)
	mux.HandleFunc("/api/v2/recovery/prove", account.RecoveryProve)
	mux.HandleFunc("/api/v2/recovery/complete", account.RecoveryComplete)
	mux.HandleFunc("/api/v2/account/reauth", setupAllowed(account.Reauth))
	mux.HandleFunc("/api/v2/account/password", authenticated(account.ChangePassword))
	mux.HandleFunc("/api/v2/account/recovery-codes", setupAllowed(account.RegenerateRecoveryCodes))
	mux.HandleFunc("/api/v2/account/email/challenge", authenticated(account.EmailChallenge))
	mux.HandleFunc("/api/v2/account/email/verify", authenticated(account.EmailVerify))
	mux.HandleFunc("/api/v2/auth/setup/ack-recovery-codes", setupAllowed(account.AckRecoveryCodes))
	// v2 profile lifecycle. Deletion status/cancel are credentialed (not session based) because
	// requesting deletion revokes every session.
	life := handlers.NewAccountLifecycleHandler(deps.AccountLifecycle, deps.Logger)
	mux.HandleFunc("/api/v2/account/profile", authenticated(life.Profile))
	mux.HandleFunc("/api/v2/usernames/availability", life.UsernameAvailability)
	mux.HandleFunc("/api/v2/account/username", authenticated(life.ChangeUsername))
	mux.HandleFunc("/api/v2/account/deletion", authenticated(life.RequestDeletion))
	mux.HandleFunc("/api/v2/account/deletion/status", life.DeletionStatus)
	mux.HandleFunc("/api/v2/account/deletion/cancel", life.CancelDeletion)
	mux.HandleFunc("/api/v2/account/sessions", authenticated(life.Sessions))
	mux.HandleFunc("/api/v2/account/sessions/revoke", authenticated(life.RevokeSession))
	mux.HandleFunc("/api/v2/auth/logout-all", authenticated(life.LogoutAll))
	// v2 enrollment, bootstrap, refresh and logout.
	authV2 := handlers.NewAuthV2Handler(deps.AuthV2, deps.Logger)
	mux.HandleFunc("/api/v2/auth/registered/begin", authV2.RegisteredBegin)
	mux.HandleFunc("/api/v2/auth/setup/resume", authV2.SetupResume)
	mux.HandleFunc("/api/v2/auth/server-key", authV2.ServerKey)
	mux.HandleFunc("/api/v2/auth/enroll/challenge", authV2.EnrollChallenge)
	mux.HandleFunc("/api/v2/auth/enroll/finish", authV2.EnrollFinish)
	mux.HandleFunc("/api/v2/auth/setup/activate", setupAllowed(authV2.Activate))
	mux.HandleFunc("/api/v2/auth/bootstrap", setupAllowed(authV2.Bootstrap))
	events := handlers.NewAccountEvents(deps.Pool, deps.Validator)
	mux.HandleFunc("/api/v2/events/snapshot", authenticated(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		q.Set("snapshot", "extended")
		q.Set("include", "device_key_fingerprint")
		r.URL.RawQuery = q.Encode()
		authV2.Bootstrap(w, r)
	}))
	mux.HandleFunc("/api/v2/events/ticket", authenticated(events.Ticket))
	mux.HandleFunc("/api/v2/events/stream", events.Stream)
	mux.HandleFunc("/api/v2/auth/refresh", authV2.Refresh)
	mux.HandleFunc("/api/v2/auth/logout", setupAllowed(authV2.Logout))
	mux.HandleFunc("/api/v1/calls", authenticated(callHandler.Create))
	mux.HandleFunc("/api/v1/calls/join", authenticated(callHandler.Join))
	mux.HandleFunc("/api/v1/calls/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/calls/")
		parts := strings.Split(strings.Trim(path, "/"), "/")
		if len(parts) < 1 || parts[0] == "" {
			http.NotFound(w, r)
			return
		}
		callID := parts[0]
		if len(parts) == 2 && parts[1] == "signal" {
			callHandler.WebSocket(w, r, callID)
			return
		}
		authenticated(func(w http.ResponseWriter, r *http.Request) {
			if len(parts) == 1 && r.Method == http.MethodGet {
				callHandler.Get(w, r, callID)
				return
			}
			if len(parts) != 2 || r.Method != http.MethodPost {
				http.NotFound(w, r)
				return
			}
			switch parts[1] {
			case "accept":
				callHandler.Accept(w, r, callID)
			case "state":
				callHandler.SetState(w, r, callID)
			case "end":
				callHandler.End(w, r, callID)
			case "signal-ticket":
				callHandler.SignalTicket(w, r, callID)
			case "direct-ticket":
				callHandler.DirectTicket(w, r, callID)
			default:
				http.NotFound(w, r)
			}
		})(w, r)
	})

	publicLimited := limitPublicOperations(deps.Config.PublicAuthIPPerMinute, deps.Config.PublicAuthScopePerMinute, mux)
	stack := middleware.Recovery(deps.Logger, middleware.Logging(deps.Logger, middleware.CORS(deps.Config, middleware.RateLimit(deps.Config, deps.Cache, middleware.Lockdown(deps.Config, deps.Cache, publicLimited)))))
	return stack
}
