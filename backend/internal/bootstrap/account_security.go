package bootstrap

import (
	"crypto/ecdh"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/repository/accountsec"
	"ipv6ftp/internal/service"
	"ipv6ftp/internal/transport/http/handlers"
)

// buildAccountSecurity returns the v2 account-security service, or an untyped
// nil interface when RECOVERY_PEPPER / EMAIL_PAYLOAD_KEY are not configured so
// the routes fail closed with "unavailable". Returning a nil *AccountSecurityService
// would produce a non-nil interface and a nil-pointer panic instead.
func buildAccountSecurity(cfg config.Config, pool *pgxpool.Pool) (handlers.AccountSecurityAPI, error) {
	if cfg.RecoveryPepper == "" && cfg.EmailPayloadKey == "" {
		return nil, nil
	}
	key, err := base64.StdEncoding.DecodeString(cfg.EmailPayloadKey)
	if err != nil {
		return nil, fmt.Errorf("EMAIL_PAYLOAD_KEY: %w", err)
	}
	svc, err := service.NewAccountSecurityService(accountsec.New(pool), service.AccountSecurityConfig{
		RecoveryPepper: []byte(cfg.RecoveryPepper),
		PayloadKey:     key,
		PayloadKeyVer:  cfg.EmailPayloadKeyVersion,
	})
	if err != nil {
		return nil, err
	}
	return svc, nil
}

// buildAccountLifecycle wires the profile, deletion and session service. It needs the
// account-security service for fresh-authentication grants, so it is disabled (untyped
// nil, routes answer "unavailable") whenever account security is.
func buildAccountLifecycle(security handlers.AccountSecurityAPI, pool *pgxpool.Pool) (handlers.AccountLifecycleAPI, error) {
	if security == nil {
		return nil, nil
	}
	svc, err := service.NewAccountLifecycleService(accountsec.New(pool), security)
	if err != nil {
		return nil, err
	}
	return svc, nil
}

// buildAuthV2 wires device enrollment, bootstrap, refresh and logout. It returns an untyped
// nil (routes answer "unavailable") unless NOISE_STATIC_KEY is configured; config.Load already
// guarantees the signing pepper exists in that case.
func buildAuthV2(cfg config.Config, pool *pgxpool.Pool, identity repository.IdentityRepo) (handlers.AuthV2API, error) {
	if cfg.NoiseStaticKey == "" {
		return nil, nil
	}
	raw, err := base64.StdEncoding.DecodeString(cfg.NoiseStaticKey)
	if err != nil {
		return nil, fmt.Errorf("NOISE_STATIC_KEY: %w", err)
	}
	key, err := ecdh.X25519().NewPrivateKey(raw)
	if err != nil {
		return nil, fmt.Errorf("NOISE_STATIC_KEY: %w", err)
	}
	var rotation *service.EnrollmentRotation
	if cfg.EnrollmentRotationSigner != "" || cfg.EnrollmentRotationOrigin != "" ||
		cfg.EnrollmentRotationEpoch != "" || cfg.EnrollmentPreviousKey != "" || cfg.EnrollmentPreviousKeyID != "" {
		encoded, err := base64.StdEncoding.DecodeString(cfg.EnrollmentRotationSigner)
		if err != nil {
			return nil, fmt.Errorf("invalid enrollment rotation signer encoding")
		}
		signer, err := x509.ParseECPrivateKey(encoded)
		if err != nil {
			return nil, fmt.Errorf("invalid enrollment rotation signer")
		}
		epoch, err := strconv.ParseUint(cfg.EnrollmentRotationEpoch, 10, 32)
		if err != nil {
			return nil, fmt.Errorf("invalid enrollment rotation epoch")
		}
		rotation = &service.EnrollmentRotation{Origin: cfg.EnrollmentRotationOrigin, Epoch: uint32(epoch), Signer: signer, PreviousKeyID: cfg.EnrollmentPreviousKeyID}
		if cfg.EnrollmentPreviousKey != "" {
			raw, err := base64.StdEncoding.DecodeString(cfg.EnrollmentPreviousKey)
			if err != nil {
				return nil, fmt.Errorf("invalid previous enrollment key encoding")
			}
			rotation.PreviousKey, err = ecdh.X25519().NewPrivateKey(raw)
			if err != nil {
				return nil, fmt.Errorf("invalid previous enrollment key")
			}
		}
	}
	svc, err := service.NewAuthV2Service(accountsec.New(pool), identity, service.AuthV2Config{
		Pepper:    []byte(cfg.RecoveryPepper),
		JWTSecret: []byte(cfg.JWTSecret),
		ServerKey: key,
		KeyID:     cfg.NoiseKeyID,
		Rotation:  rotation,
	})
	if err != nil {
		return nil, err
	}
	return svc, nil
}
