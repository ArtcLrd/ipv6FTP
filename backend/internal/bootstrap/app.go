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
	Config     config.Config
	Logger     *slog.Logger
	Pool       *pgxpool.Pool
	Cache      repository.CacheRepo
	Hub        *realtime.Hub
	Signals    *realtime.CallSignalHub
	Broker     *realtime.SSEBroker
	Auth       *service.AuthService
	User       *service.UserService
	Phonebook  *service.PhonebookService
	Call       *service.CallService
	Router     http.Handler
	Rendezvous *realtime.RendezvousServer
	closeFns   []func(context.Context) error
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
	accountSecurity, err := buildAccountSecurity(cfg, pool)
	if err != nil {
		return nil, fmt.Errorf("account security init failed: %w", err)
	}
	if accountSecurity == nil {
		log.Warn("RECOVERY_PEPPER/EMAIL_PAYLOAD_KEY not set; /api/v2 recovery and account-security routes will answer unavailable")
	}
	accountLifecycle, err := buildAccountLifecycle(accountSecurity, pool)
	if err != nil {
		return nil, fmt.Errorf("account lifecycle init failed: %w", err)
	}
	authV2, err := buildAuthV2(cfg, pool, identityRepo)
	if err != nil {
		return nil, fmt.Errorf("auth v2 init failed: %w", err)
	}
	workerCtx, stopWorker := context.WithCancel(context.Background())
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
				cleanupCtx, cancel := context.WithTimeout(workerCtx, 10*time.Second)
				_, err := pool.Exec(cleanupCtx, `DELETE FROM iam.account_event_tickets WHERE token_hash IN (SELECT token_hash FROM iam.account_event_tickets WHERE expires_at < NOW() LIMIT 1000)`)
				if err == nil {
					_, err = pool.Exec(cleanupCtx, `DELETE FROM iam.account_events WHERE (principal_id, sequence) IN (SELECT principal_id, sequence FROM iam.account_events WHERE expires_at < NOW() LIMIT 1000)`)
				}
				cancel()
				if err != nil && workerCtx.Err() == nil {
					log.Warn("account event retention cleanup failed", "error", err)
				}
			}
		}
	}()
	closeFns = append([]func(context.Context) error{func(context.Context) error { stopWorker(); <-workerDone; return nil }}, closeFns...)
	router := transporthttp.NewRouter(transporthttp.RouterDeps{Pool: pool, Config: cfg, Logger: log, Auth: authSvc, User: userSvc, Phonebook: phoneSvc, Call: callSvc, Hub: hub, Signals: signals, Broker: broker, Cache: cache, UserRepo: userRepo, ContactRepo: contactRepo, Validator: identityRepo, AccountSecurity: accountSecurity, AccountLifecycle: accountLifecycle, AuthV2: authV2})
	rendezvousServer, err := realtime.ListenRendezvous(cfg.RendezvousUDPAddr, cache, signals)
	if err != nil {
		stopWorker()
		<-workerDone
		return nil, fmt.Errorf("UDP rendezvous init failed: %w", err)
	}
	closeFns = append(closeFns, func(context.Context) error { return rendezvousServer.Close() })
	return &App{Config: cfg, Logger: log, Pool: pool, Cache: cache, Hub: hub, Signals: signals, Broker: broker, Auth: authSvc, User: userSvc, Phonebook: phoneSvc, Call: callSvc, Router: router, Rendezvous: rendezvousServer, closeFns: closeFns}, nil
}

func (a *App) Close(ctx context.Context) error {
	for _, closeFn := range a.closeFns {
		_ = closeFn(ctx)
	}
	return nil
}
