package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"ipv6ftp/internal/accountpolicy"
	appErrors "ipv6ftp/internal/errors"
	"ipv6ftp/internal/transport/http/contracts"
)

// Repository errors the service maps to client outcomes.
var (
	ErrAccountNotFound = errors.New("account not found")
	ErrEmailTaken      = errors.New("recovery email already verified by another account")
	ErrStaleCredential = errors.New("credential version changed")
	ErrGrantUnusable   = errors.New("recovery grant unusable")
)

type AccountCredential struct {
	PasswordHash  string
	Version       int
	RecoveryAcked bool
}

type Challenge struct {
	ID             string
	Purpose        string
	PrincipalID    string
	Email          string
	AddressVersion int
	State          accountpolicy.EmailChallenge
	IssuedAt       []time.Time // earlier issues in the same purpose/scope, for resend limits
}

type OutboxItem struct {
	ChallengeID string
	Recipient   string
	Template    string
	Ciphertext  []byte
	KeyVersion  int
	ExpiresAt   time.Time
}

// AccountSecurityRepo is the persistence boundary for M3. Implementations must
// make each method atomic; Replace/Consume/Apply methods especially.
type AccountSecurityRepo interface {
	GetCredential(ctx context.Context, principalID string) (AccountCredential, error)
	FindPrincipalByUsername(ctx context.Context, username string) (string, error)
	FindPrincipalByVerifiedEmail(ctx context.Context, email string) (principalID string, err error)

	// ReplaceRecoverySet retires any active set, stores the new verifiers and clears the acknowledgement.
	ReplaceRecoverySet(ctx context.Context, principalID string, expectedVersion int, verifiers []string) error
	AckRecoverySet(ctx context.Context, principalID, verifier string) error
	ActiveRecoveryVerifiers(ctx context.Context, principalID string) ([]string, error)
	// ConsumeRecoveryVerifier marks one verifier used; false if already consumed.
	ConsumeRecoveryVerifier(ctx context.Context, principalID, verifier string) (bool, error)

	CreateRecoveryGrant(ctx context.Context, principalID string, credentialVersion int, method, tokenHash string, expires time.Time) error
	// ConsumeRecoveryGrant atomically marks the grant used and returns its owner and credential version.
	ConsumeRecoveryGrant(ctx context.Context, tokenHash string, now time.Time) (principalID string, credentialVersion int, err error)

	// ApplyCredentialChange atomically sets the hash, increments the version when it still equals
	// expectedVersion, revokes sessions and recovery grants, and (when revokeDevices) devices.
	ApplyCredentialChange(ctx context.Context, principalID string, expectedVersion int, newHash string, revokeDevices bool) error

	// SupersedeAndStoreChallenge supersedes any active challenge for the same purpose/owner/version and stores the new one with its outbox item.
	SupersedeAndStoreChallenge(ctx context.Context, c Challenge, item OutboxItem) (string, error)
	RecentChallengeIssues(ctx context.Context, purpose, principalID string, since time.Time) ([]time.Time, error)
	GetChallenge(ctx context.Context, id string) (Challenge, error)
	SaveChallengeState(ctx context.Context, id string, state accountpolicy.EmailChallenge, consumed bool) error
	// AssignVerifiedEmail atomically sets the unique verified address; ErrEmailTaken on conflict.
	AssignVerifiedEmail(ctx context.Context, principalID, email string) error
}

type AccountSecurityConfig struct {
	RecoveryPepper []byte // at least 16 bytes
	PayloadKey     []byte // 32 bytes (AES-256-GCM)
	PayloadKeyVer  int
}

type AccountSecurityService struct {
	repo AccountSecurityRepo
	cfg  AccountSecurityConfig
	now  func() time.Time
}

func NewAccountSecurityService(repo AccountSecurityRepo, cfg AccountSecurityConfig) (*AccountSecurityService, error) {
	if len(cfg.RecoveryPepper) < 16 {
		return nil, errors.New("recovery pepper must be at least 16 bytes")
	}
	if len(cfg.PayloadKey) != 32 {
		return nil, errors.New("email payload key must be 32 bytes")
	}
	return &AccountSecurityService{repo: repo, cfg: cfg, now: time.Now}, nil
}

func apiErr(code, msg string) error {
	return appErrors.NewCoded(msg, contracts.StatusFor(code), code, nil)
}

const recoveryGrantLifetime = 15 * time.Minute

// ---- fresh authentication ----

type freshToken struct {
	Principal string `json:"p"`
	Operation string `json:"o"`
	Version   int    `json:"v"`
	Issued    int64  `json:"i"`
}

func (s *AccountSecurityService) mac(domain, body string) string {
	m := hmac.New(sha256.New, s.cfg.RecoveryPepper)
	m.Write([]byte(domain + "|" + body))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// IssueFreshAuth verifies the password and returns a short grant bound to one
// operation, one account and the current credential version.
func (s *AccountSecurityService) IssueFreshAuth(ctx context.Context, principalID, password, operation string) (string, int, error) {
	denied := apiErr(contracts.CodeForbidden, "Authentication failed")
	cred, err := s.repo.GetCredential(ctx, principalID)
	if err != nil || !checkPasswordCredential(cred.PasswordHash, password) {
		return "", 0, denied
	}
	body, _ := json.Marshal(freshToken{Principal: principalID, Operation: operation, Version: cred.Version, Issued: s.now().Unix()})
	enc := base64.RawURLEncoding.EncodeToString(body)
	return enc + "." + s.mac("fresh-auth-v1", enc), int(accountpolicy.FreshAuthMaxAge.Seconds()), nil
}

// RequireFreshAuth accepts a grant only for the same account and operation,
// within five minutes, and while the credential version is unchanged.
func (s *AccountSecurityService) RequireFreshAuth(ctx context.Context, principalID, grant, operation string) error {
	_, err := s.freshAuthVersion(ctx, principalID, grant, operation)
	return err
}

func (s *AccountSecurityService) freshAuthVersion(ctx context.Context, principalID, grant, operation string) (int, error) {
	denied := apiErr(contracts.CodeForbidden, "Fresh authentication required")
	parts := strings.Split(grant, ".")
	if len(parts) != 2 || !hmac.Equal([]byte(parts[1]), []byte(s.mac("fresh-auth-v1", parts[0]))) {
		return 0, denied
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	var t freshToken
	if err != nil || json.Unmarshal(raw, &t) != nil || t.Principal != principalID {
		return 0, denied
	}
	if (accountpolicy.FreshAuth{Operation: t.Operation, IssuedAt: time.Unix(t.Issued, 0)}).Require(operation, s.now()) != nil {
		return 0, denied
	}
	cred, err := s.repo.GetCredential(ctx, principalID)
	if err != nil || cred.Version != t.Version {
		return 0, denied
	}
	return t.Version, nil
}

// ---- saved recovery codes ----

// RegenerateRecoveryCodes binds replacement to the credential version verified by fresh authentication.
func (s *AccountSecurityService) RegenerateRecoveryCodes(ctx context.Context, principalID, grant string) ([]string, error) {
	version, err := s.freshAuthVersion(ctx, principalID, grant, "recovery_codes")
	if err != nil {
		return nil, err
	}
	return s.issueRecoveryCodes(ctx, principalID, version)
}

func (s *AccountSecurityService) issueRecoveryCodes(ctx context.Context, principalID string, expectedVersion int) ([]string, error) {
	set, err := accountpolicy.GenerateRecoverySet(s.cfg.RecoveryPepper, nil)
	if err != nil {
		return nil, apiErr(contracts.CodeUnavailable, "Could not generate codes")
	}
	verifiers := make([]string, len(set))
	display := make([]string, len(set))
	for i, c := range set {
		verifiers[i], display[i] = c.Verifier, c.Display
	}
	if err := s.repo.ReplaceRecoverySet(ctx, principalID, expectedVersion, verifiers); errors.Is(err, ErrStaleCredential) {
		return nil, apiErr(contracts.CodeConflict, "Account changed; retry")
	} else if err != nil {
		return nil, apiErr(contracts.CodeUnavailable, "Could not store codes")
	}
	return display, nil
}

func (s *AccountSecurityService) AcknowledgeRecoveryCodes(ctx context.Context, principalID, code string) error {
	raw, err := accountpolicy.ParseRecoveryCode(code)
	if err != nil {
		return apiErr(contracts.CodeValidationFailed, "Invalid recovery code")
	}
	verifier := accountpolicy.RecoveryVerifier(s.cfg.RecoveryPepper, raw)
	if err := s.repo.AckRecoverySet(ctx, principalID, verifier); errors.Is(err, ErrAccountNotFound) {
		return apiErr(contracts.CodeConflict, "Recovery codes changed; save the current set")
	} else if err != nil {
		return apiErr(contracts.CodeUnavailable, "Could not acknowledge codes")
	}
	return nil
}

// ---- password change ----

func (s *AccountSecurityService) ChangePassword(ctx context.Context, principalID, grant, newPassword string) error {
	if err := accountpolicy.ValidatePassword(newPassword); err != nil {
		return apiErr(contracts.CodeValidationFailed, err.Error())
	}
	version, err := s.freshAuthVersion(ctx, principalID, grant, "password_change")
	if err != nil {
		return err
	}
	hash, err := hashPasswordCredential(newPassword)
	if err != nil {
		return apiErr(contracts.CodeUnavailable, "Could not update password")
	}
	if err := s.repo.ApplyCredentialChange(ctx, principalID, version, hash, false); err != nil {
		if errors.Is(err, ErrStaleCredential) {
			return apiErr(contracts.CodeConflict, "Account changed; retry")
		}
		return apiErr(contracts.CodeUnavailable, "Could not update password")
	}
	return nil
}

// ---- recovery ----

type recoveryToken struct {
	Principal string `json:"p,omitempty"`
	Method    string `json:"m"`
	Challenge string `json:"c,omitempty"`
	Expires   int64  `json:"e"`
	Nonce     string `json:"n"`
}

func (s *AccountSecurityService) signToken(t recoveryToken) string {
	body, _ := json.Marshal(t)
	enc := base64.RawURLEncoding.EncodeToString(body)
	m := hmac.New(sha256.New, s.cfg.RecoveryPepper)
	m.Write([]byte("recovery-id-v1|" + enc))
	return enc + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (s *AccountSecurityService) openToken(tok string) (recoveryToken, bool) {
	parts := strings.Split(tok, ".")
	if len(parts) != 2 {
		return recoveryToken{}, false
	}
	m := hmac.New(sha256.New, s.cfg.RecoveryPepper)
	m.Write([]byte("recovery-id-v1|" + parts[0]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(sig, m.Sum(nil)) {
		return recoveryToken{}, false
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	var t recoveryToken
	if err != nil || json.Unmarshal(body, &t) != nil || s.now().Unix() > t.Expires {
		return recoveryToken{}, false
	}
	return t, true
}

func (s *AccountSecurityService) newNonce() string {
	b := make([]byte, 9)
	_, _ = crand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// BeginRecovery always returns an opaque recovery_id; the response never
// reveals whether the account or address exists.
func (s *AccountSecurityService) BeginRecovery(ctx context.Context, method, identifier string) (string, error) {
	tok := recoveryToken{Method: method, Expires: s.now().Add(recoveryGrantLifetime).Unix(), Nonce: s.newNonce()}
	switch method {
	case "saved_code":
		if pid, err := s.repo.FindPrincipalByUsername(ctx, accountpolicy.CanonicalUsername(identifier)); err == nil {
			tok.Principal = pid
		}
	case "email":
		email := strings.ToLower(strings.TrimSpace(identifier))
		if pid, err := s.repo.FindPrincipalByVerifiedEmail(ctx, email); err == nil {
			// Resend limits apply silently: exceeding them must not reveal that the address exists.
			if id, err := s.issueChallenge(ctx, "recover_account", pid, email, 0); err == nil {
				tok.Principal, tok.Challenge = pid, id
			}
		}
	default:
		return "", apiErr(contracts.CodeValidationFailed, "Unsupported method")
	}
	return s.signToken(tok), nil
}

// ProveRecovery verifies a saved code or emailed code and returns a one-time recovery grant.
func (s *AccountSecurityService) ProveRecovery(ctx context.Context, recoveryID, code string) (string, error) {
	generic := apiErr(contracts.CodeForbidden, "Recovery could not be completed")
	tok, ok := s.openToken(recoveryID)
	if !ok || tok.Principal == "" {
		return "", generic
	}
	cred, err := s.repo.GetCredential(ctx, tok.Principal)
	if err != nil {
		return "", generic
	}
	switch tok.Method {
	case "saved_code":
		verifiers, err := s.repo.ActiveRecoveryVerifiers(ctx, tok.Principal)
		if err != nil {
			return "", apiErr(contracts.CodeUnavailable, "Recovery unavailable")
		}
		idx := accountpolicy.VerifyRecoveryCode(s.cfg.RecoveryPepper, code, verifiers)
		if idx < 0 {
			return "", generic
		}
		if used, err := s.repo.ConsumeRecoveryVerifier(ctx, tok.Principal, verifiers[idx]); err != nil || !used {
			return "", generic
		}
	case "email":
		if tok.Challenge == "" {
			return "", generic
		}
		ch, err := s.repo.GetChallenge(ctx, tok.Challenge)
		if err != nil || ch.PrincipalID != tok.Principal {
			return "", generic
		}
		next, err := ch.State.Check(s.cfg.RecoveryPepper, ch.Purpose, ch.PrincipalID, ch.AddressVersion, code, s.now())
		consumed := err == nil
		_ = s.repo.SaveChallengeState(ctx, ch.ID, next, consumed)
		if err != nil {
			return "", generic
		}
	default:
		return "", generic
	}
	grant, _, err := newOpaqueToken()
	if err != nil {
		return "", apiErr(contracts.CodeUnavailable, "Recovery unavailable")
	}
	if err := s.repo.CreateRecoveryGrant(ctx, tok.Principal, cred.Version, tok.Method, hashOpaqueToken(grant), s.now().Add(recoveryGrantLifetime)); err != nil {
		return "", apiErr(contracts.CodeUnavailable, "Recovery unavailable")
	}
	return grant, nil
}

// CompleteRecovery sets the new password, revokes sessions and devices and
// returns a fresh recovery-code set. It does not log the user in.
func (s *AccountSecurityService) CompleteRecovery(ctx context.Context, grant, newPassword string) ([]string, error) {
	if err := accountpolicy.ValidatePassword(newPassword); err != nil {
		return nil, apiErr(contracts.CodeValidationFailed, err.Error())
	}
	pid, version, err := s.repo.ConsumeRecoveryGrant(ctx, hashOpaqueToken(grant), s.now())
	if err != nil {
		return nil, apiErr(contracts.CodeForbidden, "Recovery could not be completed")
	}
	hash, err := hashPasswordCredential(newPassword)
	if err != nil {
		return nil, apiErr(contracts.CodeUnavailable, "Recovery unavailable")
	}
	if err := s.repo.ApplyCredentialChange(ctx, pid, version, hash, true); err != nil {
		if errors.Is(err, ErrStaleCredential) {
			return nil, apiErr(contracts.CodeForbidden, "Recovery could not be completed")
		}
		return nil, apiErr(contracts.CodeUnavailable, "Recovery unavailable")
	}
	return s.issueRecoveryCodes(ctx, pid, version+1)
}

// ---- recovery email ----

// StartEmailVerification issues a challenge for a new address owned by the caller.
func (s *AccountSecurityService) StartEmailVerification(ctx context.Context, principalID, email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if owner, err := s.repo.FindPrincipalByVerifiedEmail(ctx, email); err == nil && owner != principalID {
		// Do not reveal another account's ownership; behave like a successful start.
		return newChallengeShadowID(), nil
	}
	return s.issueChallenge(ctx, "verify_email", principalID, email, 0)
}

func newChallengeShadowID() string {
	// Same shape as a real challenge UUID so the response cannot reveal that
	// the address belongs to another account.
	b := make([]byte, 16)
	_, _ = crand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func (s *AccountSecurityService) VerifyEmail(ctx context.Context, principalID, challengeID, code string) error {
	ch, err := s.repo.GetChallenge(ctx, challengeID)
	if err != nil || ch.PrincipalID != principalID || ch.Purpose != "verify_email" {
		return apiErr(contracts.CodeForbidden, "Verification failed")
	}
	next, err := ch.State.Check(s.cfg.RecoveryPepper, ch.Purpose, ch.PrincipalID, ch.AddressVersion, code, s.now())
	if saveErr := s.repo.SaveChallengeState(ctx, ch.ID, next, err == nil); saveErr != nil {
		return apiErr(contracts.CodeUnavailable, "Verification unavailable")
	}
	if err != nil {
		return apiErr(contracts.CodeForbidden, "Verification failed")
	}
	if err := s.repo.AssignVerifiedEmail(ctx, principalID, ch.Email); err != nil {
		if errors.Is(err, ErrEmailTaken) {
			return apiErr(contracts.CodeForbidden, "Verification failed")
		}
		return apiErr(contracts.CodeUnavailable, "Verification unavailable")
	}
	return nil
}

func (s *AccountSecurityService) issueChallenge(ctx context.Context, purpose, principalID, email string, addressVersion int) (string, error) {
	now := s.now()
	issues, err := s.repo.RecentChallengeIssues(ctx, purpose, principalID, now.Add(-24*time.Hour))
	if err != nil {
		return "", apiErr(contracts.CodeUnavailable, "Verification unavailable")
	}
	if err := accountpolicy.CheckResend(issues, now); err != nil {
		return "", apiErr(contracts.CodeRateLimited, "Please wait before requesting another code")
	}
	code, state, err := accountpolicy.NewEmailChallenge(s.cfg.RecoveryPepper, purpose, principalID, addressVersion, now, nil)
	if err != nil {
		return "", apiErr(contracts.CodeUnavailable, "Verification unavailable")
	}
	sealed, err := s.sealPayload(map[string]string{"code": code, "purpose": purpose})
	if err != nil {
		return "", apiErr(contracts.CodeUnavailable, "Verification unavailable")
	}
	item := OutboxItem{Recipient: email, Template: purpose, Ciphertext: sealed, KeyVersion: s.cfg.PayloadKeyVer, ExpiresAt: state.ExpiresAt}
	id, err := s.repo.SupersedeAndStoreChallenge(ctx, Challenge{Purpose: purpose, PrincipalID: principalID, Email: email, AddressVersion: addressVersion, State: state}, item)
	if err != nil {
		return "", apiErr(contracts.CodeUnavailable, "Verification unavailable")
	}
	return id, nil
}

// sealPayload encrypts the email payload (AES-256-GCM, random nonce prefix) so
// plaintext codes never sit in the outbox.
func (s *AccountSecurityService) sealPayload(v any) ([]byte, error) {
	plain, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(s.cfg.PayloadKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := crand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plain, nil), nil
}

// OpenPayload is used by the delivery worker.
func OpenPayload(key, sealed []byte) (map[string]string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("payload too short")
	}
	plain, err := gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
	if err != nil {
		return nil, err
	}
	var out map[string]string
	return out, json.Unmarshal(plain, &out)
}
