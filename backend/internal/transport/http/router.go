package httptransport

import (
	"net/http"
	"strings"

	"log/slog"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/middleware"
	"ipv6ftp/internal/realtime"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/service"
	"ipv6ftp/internal/transport/http/handlers"
)

type RouterDeps struct {
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
}

func NewRouter(deps RouterDeps) http.Handler {
	authHandler := handlers.NewAuthHandler(deps.Config, deps.Auth)
	userHandler := handlers.NewUserHandler(deps.Config, deps.User, deps.Broker)
	phonebookHandler := handlers.NewPhonebookHandler(deps.Config, deps.Phonebook)
	callHandler := handlers.NewCallHandler(deps.Config, deps.Call, deps.Signals, deps.Validator)
	roomHandler := handlers.NewRoomHandler(deps.Config, deps.Hub, deps.Broker, deps.UserRepo, deps.ContactRepo, deps.Cache)

	mux := http.NewServeMux()
	permit := func(permission string, next http.HandlerFunc) http.HandlerFunc {
		return middleware.AuthWithPermission(deps.Config, deps.Validator, deps.Cache, permission, next)
	}
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		handlers.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/myip", roomHandler.MyIP)
	mux.HandleFunc("/api/turn-credentials", permit("turn:read", roomHandler.TURNCredentials))
	mux.HandleFunc("/api/auth/register", authHandler.Register)
	mux.HandleFunc("/api/auth/login", authHandler.Login)
	mux.HandleFunc("/api/auth/check-username", authHandler.CheckUsername)
	mux.HandleFunc("/api/auth/refresh", authHandler.Refresh)
	mux.HandleFunc("/api/auth/logout", permit("auth:logout", authHandler.Logout))
	mux.HandleFunc("/api/auth/me", permit("profile:read", authHandler.Me))
	mux.HandleFunc("/api/v1/auth/guest/bootstrap", authHandler.BootstrapGuest)
	mux.HandleFunc("/api/v1/auth/register", authHandler.Register)
	mux.HandleFunc("/api/v1/auth/login", authHandler.Login)
	mux.HandleFunc("/api/v1/auth/check-username", authHandler.CheckUsername)
	mux.HandleFunc("/api/v1/auth/refresh", authHandler.Refresh)
	mux.HandleFunc("/api/v1/auth/logout", permit("auth:logout", authHandler.Logout))
	mux.HandleFunc("/api/v1/auth/me", permit("profile:read", authHandler.Me))
	mux.HandleFunc("/api/v1/prompts", permit("prompts:read", authHandler.PendingPrompts))
	mux.HandleFunc("/api/v1/prompts/actions", permit("prompts:write", authHandler.RecordPromptAction))
	mux.HandleFunc("/api/v1/turn/credentials", permit("turn:read", roomHandler.TURNCredentials))
	mux.HandleFunc("/api/v1/calls/invitations", permit("calls:create", callHandler.CreateInvitation))
	mux.HandleFunc("/api/v1/calls/join", permit("calls:join", callHandler.Join))
	mux.HandleFunc("/api/v1/calls/usage/today", permit("calls:read_usage", callHandler.UsageToday))
	mux.HandleFunc("/api/v1/calls/", permit("calls:update_state", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/start") {
			callHandler.Start(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/end") {
			callHandler.End(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/signal") {
			callHandler.WebSocket(w, r)
			return
		}
		http.NotFound(w, r)
	}))
	mux.HandleFunc("/api/ip/update", permit("presence:write", userHandler.UpdateIP))
	mux.HandleFunc("/api/users/search", permit("users:search", userHandler.Search))
	mux.HandleFunc("/api/contacts", permit("contacts:read", userHandler.Contacts))
	mux.HandleFunc("/api/contacts/", permit("contacts:write", userHandler.DeleteContact))
	mux.HandleFunc("/api/rooms/create", permit("rooms:create", roomHandler.CreateRoom))
	mux.HandleFunc("/api/rooms/invite", permit("rooms:invite", roomHandler.Invite))
	mux.HandleFunc("/api/events", permit("events:read", userHandler.SSEEvents))
	mux.HandleFunc("/api/v1/phonebook/heartbeat", permit("presence:write", phonebookHandler.Heartbeat))
	mux.HandleFunc("/api/v1/phonebook/pubkey", permit("presence:write", phonebookHandler.UpdatePublicKey))
	mux.HandleFunc("/api/v1/phonebook/", permit("presence:read", phonebookHandler.Lookup))
	mux.HandleFunc("/api/v1/admin/lockdown", permit("admin:lockdown", roomHandler.AdminLockdown))
	mux.HandleFunc("/ws", roomHandler.WebSocket)

	stack := middleware.Recovery(deps.Logger, middleware.Logging(deps.Logger, middleware.CORS(deps.Config, middleware.RateLimit(deps.Config, deps.Cache, middleware.Lockdown(deps.Config, deps.Cache, mux)))))
	return stack
}
