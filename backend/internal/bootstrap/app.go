package bootstrap

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/logger"
	"ipv6ftp/internal/realtime"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/service"
	transporthttp "ipv6ftp/internal/transport/http"
)

type App struct {
	Config    config.Config
	Logger    *slog.Logger
	Pool      *pgxpool.Pool
	Cache     repository.CacheRepo
	Hub       *realtime.Hub
	Signals   *realtime.CallSignalHub
	Broker    *realtime.SSEBroker
	Auth      *service.AuthService
	User      *service.UserService
	Phonebook *service.PhonebookService
	Call      *service.CallService
	Router    http.Handler
	closeFns  []func(context.Context) error
}

func New(ctx context.Context) (*App, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	log := logger.New(cfg.Environment)
	buildCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	pool, err := repository.NewPool(buildCtx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("postgres init failed: %w", err)
	}
	userRepo := repository.NewPgUserRepo(pool)
	contactRepo := repository.NewPgContactRepo(pool)
	sessionRepo := repository.NewPgSessionRepo(pool)
	identityRepo := repository.NewPgIdentityRepo(pool)
	callRepo := repository.NewPgCallRepo(pool)
	phonebookRepo := repository.NewPgPhonebookRepo(pool)
	cache := repository.CacheRepo(repository.NewMemoryCacheRepo())
	var redisClient *redis.Client
	closeFns := []func(context.Context) error{
		func(context.Context) error {
			pool.Close()
			return nil
		},
	}
	if cfg.RedisURL != "" {
		client, redisErr := repository.NewRedisClient(buildCtx, cfg.RedisURL, cfg.RedisPassword, cfg.RedisDB)
		if redisErr != nil {
			if cfg.Environment == "production" {
				return nil, fmt.Errorf("redis init failed: %w", redisErr)
			}
			log.Warn("redis unavailable, using in-memory cache", "error", redisErr)
		} else {
			redisClient = client
			cache = repository.NewRedisCacheRepo(redisClient)
			closeFns = append(closeFns, func(context.Context) error {
				return redisClient.Close()
			})
			log.Info("redis cache enabled", "addr", cfg.RedisURL)
		}
	} else if cfg.Environment == "production" {
		return nil, fmt.Errorf("REDIS_URL is required in production")
	}
	hub := realtime.NewHub()
	signals := realtime.NewCallSignalHub(redisClient)
	broker := realtime.NewSSEBroker()
	authSvc := service.NewProductionAuthService(cfg, identityRepo, userRepo, contactRepo, sessionRepo, cache, broker)
	userSvc := service.NewUserService(userRepo, contactRepo, cache, broker)
	phoneSvc := service.NewPhonebookService(phonebookRepo, cache)
	callSvc := service.NewCallService(cfg, callRepo, cache)
	router := transporthttp.NewRouter(transporthttp.RouterDeps{Config: cfg, Logger: log, Auth: authSvc, User: userSvc, Phonebook: phoneSvc, Call: callSvc, Hub: hub, Signals: signals, Broker: broker, Cache: cache, UserRepo: userRepo, ContactRepo: contactRepo, Validator: identityRepo})
	return &App{Config: cfg, Logger: log, Pool: pool, Cache: cache, Hub: hub, Signals: signals, Broker: broker, Auth: authSvc, User: userSvc, Phonebook: phoneSvc, Call: callSvc, Router: router, closeFns: closeFns}, nil
}

func (a *App) Close(ctx context.Context) error {
	for _, closeFn := range a.closeFns {
		_ = closeFn(ctx)
	}
	return nil
}
