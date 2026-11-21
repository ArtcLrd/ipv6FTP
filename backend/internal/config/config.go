package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

type Config struct {
	Port                     string
	Environment              string
	V1CredentialIssuance     string
	PublicAuthIPPerMinute    int
	PublicAuthScopePerMinute int
	DatabaseURL              string
	RedisURL                 string
	RedisPassword            string
	RedisDB                  int
	JWTSecret                string
	CORSOrigins              []string
	BcryptCost               int
	RateLimitRPS             int
	RateLimitBurst           int
	TurnURL                  string
	TurnSecret               string
	TurnUsername             string
	TurnCredential           string
	MeteredAPIKey            string
	MeteredApp               string
	MeteredDomain            string
	AppLinkBaseURL           string
	CallCodePepper           string
	RendezvousUDPAddr        string
	RendezvousPublicHost     string
	RendezvousPublicPort     int
	// Account security (M3). Optional: when unset the /api/v2 recovery and
	// account-security routes answer "unavailable" instead of running with weak defaults.
	RecoveryPepper         string // at least 16 bytes
	EmailPayloadKey        string // base64 of exactly 32 bytes
	EmailPayloadKeyVersion int

	// Device enrollment (M2). NoiseStaticKey is the server's X25519 private key (base64 of 32
	// bytes); NoiseKeyID names it so phones can pin and rotate. Optional; needs the account-security secrets.
	NoiseStaticKey           string
	NoiseKeyID               string
	EnrollmentRotationOrigin string
	EnrollmentRotationEpoch  string
	EnrollmentRotationSigner string
	EnrollmentPreviousKey    string
	EnrollmentPreviousKeyID  string
}

func Load() (Config, error) {
	cfg := Config{
		Port:                     env("PORT", "8080"),
		Environment:              env("ENVIRONMENT", "development"),
		V1CredentialIssuance:     env("V1_CREDENTIAL_ISSUANCE", "staging"),
		PublicAuthIPPerMinute:    envInt("PUBLIC_AUTH_IP_PER_MINUTE", 10),
		PublicAuthScopePerMinute: envInt("PUBLIC_AUTH_SCOPE_PER_MINUTE", 5),
		DatabaseURL:              firstNonEmpty(os.Getenv("DATABASE_URL"), os.Getenv("SUPABASE_DB_URL"), os.Getenv("POSTGRES_URL")),
		RedisURL:                 strings.TrimSpace(os.Getenv("REDIS_URL")),
		RedisPassword:            strings.TrimSpace(os.Getenv("REDIS_PASSWORD")),
		RedisDB:                  envInt("REDIS_DB", 0),
		JWTSecret:                os.Getenv("JWT_SECRET"),
		CORSOrigins:              splitList(env("CORS_ORIGINS", "*")),
		BcryptCost:               envInt("BCRYPT_COST", 12),
		RateLimitRPS:             envInt("RATE_LIMIT_RPS", 30),
		RateLimitBurst:           envInt("RATE_LIMIT_BURST", 50),
		TurnURL:                  os.Getenv("TURN_URL"),
		TurnSecret:               os.Getenv("TURN_SECRET"),
		TurnUsername:             os.Getenv("TURN_USERNAME"),
		TurnCredential:           os.Getenv("TURN_CREDENTIAL"),
		MeteredAPIKey:            os.Getenv("METERED_API_KEY"),
		MeteredApp:               os.Getenv("METERED_APP_NAME"),
		MeteredDomain:            os.Getenv("METERED_DOMAIN"),
		AppLinkBaseURL:           strings.TrimRight(os.Getenv("APP_LINK_BASE_URL"), "/"),
		CallCodePepper:           env("CALL_CODE_PEPPER", os.Getenv("JWT_SECRET")),
		RendezvousUDPAddr:        env("RENDEZVOUS_UDP_ADDR", "[::]:3478"),
		RendezvousPublicHost:     strings.TrimSpace(os.Getenv("RENDEZVOUS_PUBLIC_HOST")),
		RendezvousPublicPort:     envInt("RENDEZVOUS_PUBLIC_PORT", 3478),

		RecoveryPepper:           strings.TrimSpace(os.Getenv("RECOVERY_PEPPER")),
		EmailPayloadKey:          strings.TrimSpace(os.Getenv("EMAIL_PAYLOAD_KEY")),
		EmailPayloadKeyVersion:   envInt("EMAIL_PAYLOAD_KEY_VERSION", 1),
		NoiseStaticKey:           strings.TrimSpace(os.Getenv("NOISE_STATIC_KEY")),
		NoiseKeyID:               strings.TrimSpace(os.Getenv("NOISE_KEY_ID")),
		EnrollmentRotationOrigin: strings.TrimSpace(os.Getenv("ENROLLMENT_ROTATION_ORIGIN")),
		EnrollmentRotationEpoch:  strings.TrimSpace(os.Getenv("ENROLLMENT_ROTATION_EPOCH")),
		EnrollmentRotationSigner: strings.TrimSpace(os.Getenv("ENROLLMENT_ROTATION_SIGNER")),
		EnrollmentPreviousKey:    strings.TrimSpace(os.Getenv("ENROLLMENT_PREVIOUS_KEY")),
		EnrollmentPreviousKeyID:  strings.TrimSpace(os.Getenv("ENROLLMENT_PREVIOUS_KEY_ID")),
	}
	// Reject half-configured or weak secrets early; absence is allowed (feature off).
	if cfg.V1CredentialIssuance != "staging" && cfg.V1CredentialIssuance != "upgrade_required" {
		return Config{}, fmt.Errorf("V1_CREDENTIAL_ISSUANCE must be staging or upgrade_required")
	}
	if cfg.RecoveryPepper != "" && len(cfg.RecoveryPepper) < 16 {
		return Config{}, fmt.Errorf("RECOVERY_PEPPER must be at least 16 characters")
	}
	if cfg.EmailPayloadKey != "" {
		if key, err := base64.StdEncoding.DecodeString(cfg.EmailPayloadKey); err != nil || len(key) != 32 {
			return Config{}, fmt.Errorf("EMAIL_PAYLOAD_KEY must be base64 of exactly 32 bytes")
		}
	}
	if (cfg.RecoveryPepper == "") != (cfg.EmailPayloadKey == "") {
		return Config{}, fmt.Errorf("set both RECOVERY_PEPPER and EMAIL_PAYLOAD_KEY, or neither")
	}
	if (cfg.NoiseStaticKey == "") != (cfg.NoiseKeyID == "") {
		return Config{}, fmt.Errorf("set both NOISE_STATIC_KEY and NOISE_KEY_ID, or neither")
	}
	if cfg.NoiseStaticKey != "" {
		if key, err := base64.StdEncoding.DecodeString(cfg.NoiseStaticKey); err != nil || len(key) != 32 {
			return Config{}, fmt.Errorf("NOISE_STATIC_KEY must be base64 of exactly 32 bytes")
		}
		if !regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`).MatchString(cfg.NoiseKeyID) {
			return Config{}, fmt.Errorf("NOISE_KEY_ID must be 1-64 characters of letters, digits, _ or -")
		}
		if cfg.RecoveryPepper == "" {
			return Config{}, fmt.Errorf("NOISE_STATIC_KEY requires RECOVERY_PEPPER and EMAIL_PAYLOAD_KEY (setup grants are signed with the pepper)")
		}
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("database URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required")
	}
	if cfg.Environment == "production" && cfg.RendezvousPublicHost == "" {
		return Config{}, fmt.Errorf("RENDEZVOUS_PUBLIC_HOST is required in production")
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
