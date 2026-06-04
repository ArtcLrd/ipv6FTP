package httptransport

import (
	"net/http"

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
	Hub         *realtime.Hub
	Broker      *realtime.SSEBroker
	Cache       repository.CacheRepo
	UserRepo    repository.UserRepo
	ContactRepo repository.ContactRepo
}

func NewRouter(deps RouterDeps) http.Handler {
	authHandler := handlers.NewAuthHandler(deps.Config, deps.Auth)
	userHandler := handlers.NewUserHandler(deps.Config, deps.User, deps.Broker)
	phonebookHandler := handlers.NewPhonebookHandler(deps.Config, deps.Phonebook)
	roomHandler := handlers.NewRoomHandler(deps.Config, deps.Hub, deps.Broker, deps.UserRepo, deps.ContactRepo, deps.Cache)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		handlers.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/myip", roomHandler.MyIP)
	mux.HandleFunc("/api/turn-credentials", roomHandler.TURNCredentials)
	mux.HandleFunc("/api/auth/register", authHandler.Register)
	mux.HandleFunc("/api/auth/login", authHandler.Login)
	mux.HandleFunc("/api/auth/refresh", authHandler.Refresh)
	mux.HandleFunc("/api/auth/logout", middleware.Auth(deps.Config, authHandler.Logout))
	mux.HandleFunc("/api/auth/me", middleware.Auth(deps.Config, authHandler.Me))
	mux.HandleFunc("/api/ip/update", middleware.Auth(deps.Config, userHandler.UpdateIP))
	mux.HandleFunc("/api/users/search", middleware.Auth(deps.Config, userHandler.Search))
	mux.HandleFunc("/api/contacts", middleware.Auth(deps.Config, userHandler.Contacts))
	mux.HandleFunc("/api/contacts/", middleware.Auth(deps.Config, userHandler.DeleteContact))
	mux.HandleFunc("/api/rooms/create", middleware.Auth(deps.Config, roomHandler.CreateRoom))
	mux.HandleFunc("/api/rooms/invite", middleware.Auth(deps.Config, roomHandler.Invite))
	mux.HandleFunc("/api/events", middleware.Auth(deps.Config, userHandler.SSEEvents))
	mux.HandleFunc("/api/v1/phonebook/heartbeat", middleware.Auth(deps.Config, phonebookHandler.Heartbeat))
	mux.HandleFunc("/api/v1/phonebook/pubkey", middleware.Auth(deps.Config, phonebookHandler.UpdatePublicKey))
	mux.HandleFunc("/api/v1/phonebook/", middleware.Auth(deps.Config, phonebookHandler.Lookup))
	mux.HandleFunc("/api/v1/admin/lockdown", middleware.Auth(deps.Config, roomHandler.AdminLockdown))
	mux.HandleFunc("/ws", roomHandler.WebSocket)

	stack := middleware.Recovery(deps.Logger, middleware.Logging(deps.Logger, middleware.CORS(deps.Config, middleware.RateLimit(deps.Config, deps.Cache, middleware.Lockdown(deps.Config, deps.Cache, mux)))))
	return stack
}
