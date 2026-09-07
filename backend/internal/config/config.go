package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port           string
	Environment    string
	DatabaseURL    string
	RedisURL       string
	RedisPassword  string
	RedisDB        int
	JWTSecret      string
	CORSOrigins    []string
	BcryptCost     int
	RateLimitRPS   int
	RateLimitBurst int
	TurnURL        string
	TurnSecret     string
	TurnUsername   string
	TurnCredential string
	MeteredAPIKey  string
	MeteredApp     string
	MeteredDomain  string
	AppLinkBaseURL string
}

func Load() (Config, error) {
	cfg := Config{
		Port:           env("PORT", "8080"),
		Environment:    env("ENVIRONMENT", "development"),
		DatabaseURL:    firstNonEmpty(os.Getenv("DATABASE_URL"), os.Getenv("SUPABASE_DB_URL"), os.Getenv("POSTGRES_URL")),
		RedisURL:       strings.TrimSpace(os.Getenv("REDIS_URL")),
		RedisPassword:  strings.TrimSpace(os.Getenv("REDIS_PASSWORD")),
		RedisDB:        envInt("REDIS_DB", 0),
		JWTSecret:      os.Getenv("JWT_SECRET"),
		CORSOrigins:    splitList(env("CORS_ORIGINS", "*")),
		BcryptCost:     envInt("BCRYPT_COST", 12),
		RateLimitRPS:   envInt("RATE_LIMIT_RPS", 30),
		RateLimitBurst: envInt("RATE_LIMIT_BURST", 50),
		TurnURL:        os.Getenv("TURN_URL"),
		TurnSecret:     os.Getenv("TURN_SECRET"),
		TurnUsername:   os.Getenv("TURN_USERNAME"),
		TurnCredential: os.Getenv("TURN_CREDENTIAL"),
		MeteredAPIKey:  os.Getenv("METERED_API_KEY"),
		MeteredApp:     os.Getenv("METERED_APP_NAME"),
		MeteredDomain:  os.Getenv("METERED_DOMAIN"),
		AppLinkBaseURL: strings.TrimRight(os.Getenv("APP_LINK_BASE_URL"), "/"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("database URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required")
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func splitList(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			items = append(items, trimmed)
		}
	}
	return items
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
