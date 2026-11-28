package service

import (
	"context"
	"crypto/ecdh"
	"crypto/hmac"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ipv6ftp/internal/accountpolicy"
	"ipv6ftp/internal/noiseik"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/security"
	"ipv6ftp/internal/transport/http/contracts"
)

// Enrollment repository errors.
var (
	ErrChallengeUnusable = errors.New("enrollment challenge unusable")
	ErrDeviceKeyTaken    = errors.New("device key belongs to another account or was revoked")
	ErrEnrollRaced       = errors.New("account changed during enrollment")
	ErrNotAcknowledged   = errors.New("recovery codes not acknowledged")
	ErrSessionNotActive  = errors.New("session is not active")
)

const (
	setupGrantLifetime = 15 * time.Minute
	challengeLifetime  = 2 * time.Minute
	sessionLifetime    = 30 * 24 * time.Hour
	accessTokenSeconds = 900
)

type EnrollPlan struct {
	Username         string
	Generation       int64
	ExistingDeviceID string // an active device that already owns this key, else ""
	PendingDeletion  bool
	Activated        bool
}

type EnrollmentBinding struct {
	CredentialVersion int
	Generation        int64
}

type EnrollmentChallenge struct {
	PrincipalID       string
	Nonce             []byte
	Binding           EnrollmentBinding
	ServerKeyID       string
	RotationSupported bool
}

type EnrollCommit struct {
	ExpectedCredentialVersion int
	PrincipalID               string
	DeviceID                  string
	SessionID                 string
	PublicKey                 []byte
	ExpectedGeneration        int64
	RefreshHash               string // hex sha-256 of the opaque refresh token
	SessionExpires            time.Time
}

type SnapshotData struct {
	EventSequence   int64
	DevicePublicKey []byte
	Username        string
	Revision        int64
	Generation      int64
	PendingDeletion bool
	Activated       bool
}

// EnrollmentRepo is the persistence boundary for enrollment, activation and bootstrap.
// CommitEnrollment must be one transaction that locks the account.
type EnrollmentRepo interface {
	CreatePendingAccount(ctx context.Context, username, passwordHash string) (principalID string, err error)
	FindEnrollmentLogin(ctx context.Context, username string) (principalID, passwordHash string, binding EnrollmentBinding, err error)
	// StoreChallenge supersedes any open challenge for the account and stores this one.
	StoreChallenge(ctx context.Context, id string, c EnrollmentChallenge, expires time.Time) error
	// ConsumeChallenge marks the challenge used (once, unexpired) even if the handshake later fails.
	ConsumeChallenge(ctx context.Context, id string, now time.Time) (EnrollmentChallenge, error)
	PlanEnrollment(ctx context.Context, principalID string, publicKey []byte) (EnrollPlan, error)
	// CommitEnrollment revokes every earlier session and every other device, binds this device
	// and session, and bumps the device generation, or fails with ErrEnrollRaced,
	// ErrDeviceKeyTaken or ErrPendingDeletion without changing anything.
	CommitEnrollment(ctx context.Context, c EnrollCommit) error
	// Activate fails with ErrNotAcknowledged until the recovery codes were acknowledged.
	Activate(ctx context.Context, principalID, sessionID, deviceID string, generation int, operationKey string) error
	Snapshot(ctx context.Context, principalID, sessionID, deviceID string) (SnapshotData, error)
}

type AuthV2Config struct {
	Pepper    []byte // signs setup grants
	JWTSecret []byte
	ServerKey *ecdh.PrivateKey
	KeyID     string
	Rotation  *EnrollmentRotation
}

type AuthV2Service struct {
	repo             EnrollmentRepo
	identity         repository.IdentityRepo // refresh rotation and session revocation
	cfg              AuthV2Config
	now              func() time.Time
	rotationMetadata *contracts.EnrollmentRotationMetadata
}

func NewAuthV2Service(repo EnrollmentRepo, identity repository.IdentityRepo, cfg AuthV2Config) (*AuthV2Service, error) {
	if repo == nil || identity == nil {
		return nil, errors.New("auth v2 needs enrollment and identity repositories")
	}
	if len(cfg.Pepper) < 16 || len(cfg.JWTSecret) == 0 {
		return nil, errors.New("auth v2 needs the signing pepper and JWT secret")
	}
	if cfg.ServerKey == nil || cfg.ServerKey.Curve() != ecdh.X25519() || cfg.KeyID == "" {
		return nil, errors.New("auth v2 needs an X25519 server key and key id")
	}
	service := &AuthV2Service{repo: repo, identity: identity, cfg: cfg, now: time.Now}
	if cfg.Rotation != nil {
		r := cfg.Rotation
		if (r.PreviousKey == nil) != (r.PreviousKeyID == "") || r.PreviousKeyID == cfg.KeyID ||
			(r.PreviousKey != nil && r.PreviousKey.Curve() != ecdh.X25519()) {
			return nil, errors.New("invalid previous enrollment key")
		}
		public, signature, err := r.metadata(cfg.KeyID, cfg.ServerKey.PublicKey().Bytes())
		if err != nil {
			return nil, err
		}
		service.rotationMetadata = &contracts.EnrollmentRotationMetadata{Signer: public, Signature: signature, Epoch: r.Epoch}
	}
	return service, nil
}

func newUUID() string {
	var b [16]byte
	if _, err := crand.Read(b[:]); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ---- setup grants (stateless, signed, 15 minutes, bound to the credential version) ----

type setupGrant struct {
	Principal  string `json:"p"`
	Purpose    string `json:"o"`
	Version    int    `json:"v"`
	Issued     int64  `json:"i"`
	Generation *int64 `json:"g"`
}

func (s *AuthV2Service) mac(body string) string {
	m := hmac.New(sha256.New, s.cfg.Pepper)
	m.Write([]byte("setup-grant-v1|" + body))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (s *AuthV2Service) issueGrant(principalID string, binding EnrollmentBinding) (contracts.SetupGrantResponse, error) {
	body, _ := json.Marshal(setupGrant{Principal: principalID, Purpose: "setup", Version: binding.CredentialVersion, Generation: &binding.Generation, Issued: s.now().Unix()})
	enc := base64.RawURLEncoding.EncodeToString(body)
	return contracts.SetupGrantResponse{SetupGrant: enc + "." + s.mac(enc), ExpiresInSeconds: int(setupGrantLifetime.Seconds())}, nil
}

func (s *AuthV2Service) openGrant(grant string) (setupGrant, error) {
	denied := apiErr(contracts.CodeForbidden, "Setup authorization expired; sign in again")
	parts := strings.Split(grant, ".")
	if len(parts) != 2 || !hmac.Equal([]byte(parts[1]), []byte(s.mac(parts[0]))) {
		return setupGrant{}, denied
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	var g setupGrant
	if err != nil || json.Unmarshal(raw, &g) != nil || g.Purpose != "setup" || g.Principal == "" {
		return setupGrant{}, denied
	}
	age := s.now().Sub(time.Unix(g.Issued, 0))
	if age < 0 || age > setupGrantLifetime {
		return setupGrant{}, denied
	}
	if g.Generation == nil || *g.Generation < 0 || g.Version < 1 {
		return setupGrant{}, denied
	}
	return g, nil
}

// ---- registered begin and setup resume ----

// BeginRegistered creates an account in setup_pending. It issues a setup grant, never a session.
func (s *AuthV2Service) BeginRegistered(ctx context.Context, username, password string) (contracts.SetupGrantResponse, error) {
	canon, err := accountpolicy.ValidateNewUsername(username)
	if err != nil {
		return contracts.SetupGrantResponse{}, apiErr(contracts.CodeValidationFailed, "Invalid username")
	}
	if err := accountpolicy.ValidatePassword(password); err != nil {
		return contracts.SetupGrantResponse{}, apiErr(contracts.CodeValidationFailed, err.Error())
	}
	hash, err := hashPasswordCredential(password)
	if err != nil {
		return contracts.SetupGrantResponse{}, lifecycleUnavailable()
	}
	pid, err := s.repo.CreatePendingAccount(ctx, canon, hash)
	if errors.Is(err, ErrUsernameTaken) {
		// Never treat a duplicate as a fresh success: if this was a lost response, the client
		// resumes with the password through setup/resume.
		return contracts.SetupGrantResponse{}, apiErr(contracts.CodeConflict, "Username unavailable")
	}
	if err != nil {
		return contracts.SetupGrantResponse{}, lifecycleUnavailable()
	}
	return s.issueGrant(pid, EnrollmentBinding{CredentialVersion: 1, Generation: 1})
}

// ResumeSetup re-authenticates an incomplete registration or a returning user on a new phone.
// All failures are identical so it cannot be used to probe accounts.
func (s *AuthV2Service) ResumeSetup(ctx context.Context, username, password string) (contracts.SetupGrantResponse, error) {
	denied := apiErr(contracts.CodeForbidden, "Authentication failed")
	pid, hash, binding, err := s.repo.FindEnrollmentLogin(ctx, username)
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			checkPasswordCredential(dummyPasswordHash(), password)
			return contracts.SetupGrantResponse{}, denied
		}
		return contracts.SetupGrantResponse{}, lifecycleUnavailable()
	}
	if !checkPasswordCredential(hash, password) {
		return contracts.SetupGrantResponse{}, denied
	}
	return s.issueGrant(pid, binding)
}

// ---- enrollment ----

func (s *AuthV2Service) ServerKey(rotation bool) contracts.ServerKeyResponse {
	response := contracts.ServerKeyResponse{KeyID: s.cfg.KeyID, PublicKey: base64.RawURLEncoding.EncodeToString(s.cfg.ServerKey.PublicKey().Bytes())}
	if rotation {
		response.Rotation = s.rotationMetadata
	}
	return response
}

func (s *AuthV2Service) EnrollChallenge(ctx context.Context, grant string, rotation bool) (contracts.EnrollChallengeResponse, error) {
	authorization, err := s.openGrant(grant)
	if err != nil {
		return contracts.EnrollChallengeResponse{}, err
	}
	nonce := make([]byte, contracts.NonceBytes)
	if _, err := crand.Read(nonce); err != nil {
		return contracts.EnrollChallengeResponse{}, lifecycleUnavailable()
	}
	id := newUUID()
	challenge := EnrollmentChallenge{PrincipalID: authorization.Principal, Nonce: nonce, ServerKeyID: s.cfg.KeyID, RotationSupported: rotation,
		Binding: EnrollmentBinding{CredentialVersion: authorization.Version, Generation: *authorization.Generation}}
	if err := s.repo.StoreChallenge(ctx, id, challenge, s.now().Add(challengeLifetime)); err != nil {
		if errors.Is(err, ErrEnrollRaced) || errors.Is(err, ErrPendingDeletion) || errors.Is(err, ErrAccountNotFound) {
			return contracts.EnrollChallengeResponse{}, apiErr(contracts.CodeForbidden, "Setup authorization expired; sign in again")
		}
		return contracts.EnrollChallengeResponse{}, lifecycleUnavailable()
	}
	return contracts.EnrollChallengeResponse{
		ChallengeID: id, PrincipalID: challenge.PrincipalID, Nonce: base64.RawURLEncoding.EncodeToString(nonce),
		ExpiresInSeconds: int(challengeLifetime.Seconds()), ServerKeyID: s.cfg.KeyID,
	}, nil
}

// enrollPrologue binds the purpose, the challenge id and its nonce. The principal is bound
// implicitly: the challenge id identifies it server-side, and the phone never needs to know it.
func enrollPrologue(challengeID string, nonce []byte) ([]byte, error) {
	return noiseik.Prologue("enroll", []byte(challengeID), nonce)
}

// EnrollFinish proves possession of the device key with a Noise IK handshake and returns the
// session encrypted inside handshake message 2, readable only with that key's private half.
func (s *AuthV2Service) EnrollFinish(ctx context.Context, challengeID, handshake string) (contracts.EnrollFinishResponse, error) {
	denied := apiErr(contracts.CodeForbidden, "Enrollment failed; request a new challenge")
	msg1, err := base64.RawURLEncoding.DecodeString(handshake)
	if err != nil {
		return contracts.EnrollFinishResponse{}, apiErr(contracts.CodeValidationFailed, "Invalid handshake")
	}
	challenge, err := s.repo.ConsumeChallenge(ctx, challengeID, s.now())
	if errors.Is(err, ErrChallengeUnusable) {
		return contracts.EnrollFinishResponse{}, denied
	}
	if err != nil {
		return contracts.EnrollFinishResponse{}, lifecycleUnavailable()
	}
	key := s.cfg.ServerKey
	if challenge.ServerKeyID != s.cfg.KeyID {
		if s.cfg.Rotation == nil || s.cfg.Rotation.PreviousKeyID != challenge.ServerKeyID {
			return contracts.EnrollFinishResponse{}, denied
		}
		key = s.cfg.Rotation.PreviousKey
	}
	pid := challenge.PrincipalID
	prologue, err := enrollPrologue(challengeID, challenge.Nonce)
	if err != nil {
		return contracts.EnrollFinishResponse{}, lifecycleUnavailable()
	}
	resp, err := noiseik.NewResponder(key, prologue)
	if err != nil {
		return contracts.EnrollFinishResponse{}, lifecycleUnavailable()
	}
	phoneKey, payload, err := resp.ReadMessage1(msg1)
	if err != nil || len(payload) != 0 {
		return contracts.EnrollFinishResponse{}, denied
	}
	plan, err := s.repo.PlanEnrollment(ctx, pid, phoneKey)
	if errors.Is(err, ErrAccountNotFound) {
		return contracts.EnrollFinishResponse{}, denied
	}
	if err != nil {
		return contracts.EnrollFinishResponse{}, lifecycleUnavailable()
	}
	if plan.PendingDeletion {
		return contracts.EnrollFinishResponse{}, apiErr(contracts.CodeForbidden, "Account is pending deletion")
	}

	if plan.Generation != challenge.Binding.Generation {
		return contracts.EnrollFinishResponse{}, apiErr(contracts.CodeConflict, "Account changed during enrollment; start again")
	}
	deviceID := plan.ExistingDeviceID
	if deviceID == "" {
		deviceID = newUUID()
	}
	sessionID := newUUID()
	refresh, _, err := newOpaqueToken()
	if err != nil {
		return contracts.EnrollFinishResponse{}, lifecycleUnavailable()
	}
	access, err := security.IssueSessionAccessToken(s.cfg.JWTSecret, pid, sessionID, deviceID, plan.Username, "app_user", "registered", "", int(plan.Generation+1))
	if err != nil {
		return contracts.EnrollFinishResponse{}, lifecycleUnavailable()
	}
	state := "recovery_setup"
	if plan.Activated {
		state = "active"
	}
	session := contracts.SessionGrant{
		PrincipalID: pid,
		AccessToken: access, RefreshToken: refresh, ExpiresInSeconds: accessTokenSeconds,
		SessionID: sessionID, DeviceID: deviceID, Generation: plan.Generation + 1, AccountState: state,
	}
	if challenge.RotationSupported && s.rotationMetadata != nil {
		session.RotationSigner = s.rotationMetadata.Signer
	}
	grant, _ := json.Marshal(session)
	// Encrypt first, commit second: if the commit fails nothing was ever released, and if
	// encryption fails nothing was ever committed.
	msg2, _, err := resp.WriteMessage2(grant)
	if err != nil {
		return contracts.EnrollFinishResponse{}, lifecycleUnavailable()
	}
	err = s.repo.CommitEnrollment(ctx, EnrollCommit{
		PrincipalID: pid, DeviceID: deviceID, SessionID: sessionID, PublicKey: phoneKey,
		ExpectedGeneration: challenge.Binding.Generation, ExpectedCredentialVersion: challenge.Binding.CredentialVersion, RefreshHash: hashOpaqueToken(refresh),
		SessionExpires: s.now().Add(sessionLifetime),
	})
	switch {
	case err == nil:
	case errors.Is(err, ErrEnrollRaced):
		return contracts.EnrollFinishResponse{}, apiErr(contracts.CodeConflict, "Account changed during enrollment; start again")
	case errors.Is(err, ErrDeviceKeyTaken):
		return contracts.EnrollFinishResponse{}, apiErr(contracts.CodeConflict, "This device identity cannot be used with this account")
	case errors.Is(err, ErrPendingDeletion):
		return contracts.EnrollFinishResponse{}, apiErr(contracts.CodeForbidden, "Account is pending deletion")
	default:
		return contracts.EnrollFinishResponse{}, lifecycleUnavailable()
	}
	return contracts.EnrollFinishResponse{Handshake: base64.RawURLEncoding.EncodeToString(msg2)}, nil
}

// ---- activation and bootstrap ----

func (s *AuthV2Service) Activate(ctx context.Context, principalID, sessionID, deviceID string, generation int, operationKey string) error {
	err := s.repo.Activate(ctx, principalID, sessionID, deviceID, generation, operationKey)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, accountpolicy.ErrOperationConflict):
		return apiErr(contracts.CodeOperationConflict, "Idempotency key was used for another activation")
	case errors.Is(err, ErrNotAcknowledged):
		return apiErr(contracts.CodeConflict, "Save and acknowledge your recovery codes first")
	case errors.Is(err, ErrAccountNotFound), errors.Is(err, ErrSessionNotActive):
		return apiErr(contracts.CodeSessionInvalid, "Sign in required")
	}
	return lifecycleUnavailable()
}

func (s *AuthV2Service) Bootstrap(ctx context.Context, principalID, sessionID, deviceID string) (contracts.BootstrapSnapshot, error) {
	d, err := s.repo.Snapshot(ctx, principalID, sessionID, deviceID)
	if errors.Is(err, ErrSessionNotActive) || errors.Is(err, ErrAccountNotFound) {
		return contracts.BootstrapSnapshot{}, apiErr(contracts.CodeSessionInvalid, "Sign in required")
	}
	if err != nil {
		return contracts.BootstrapSnapshot{}, lifecycleUnavailable()
	}
	snap := contracts.BootstrapSnapshot{
		SchemaVersion: 2, Revision: d.Revision, PrincipalID: principalID, DeviceID: deviceID, SessionID: sessionID,
		Generation: d.Generation, Username: d.Username, AccountType: "registered", AccountState: "recovery_setup",
		Capabilities: []string{}, PolicyVersion: 1,
	}
	var sequence [8]byte
	binary.BigEndian.PutUint64(sequence[:], uint64(d.EventSequence))
	cursor := base64.RawURLEncoding.EncodeToString(sequence[:])
	snap.EventCursor = &cursor
	if len(d.DevicePublicKey) == contracts.PublicKeyBytes {
		digest := sha256.Sum256(d.DevicePublicKey)
		snap.DeviceKeyFingerprint = hex.EncodeToString(digest[:])
	}
	switch {
	case d.PendingDeletion:
		snap.AccountState = "pending_deletion"
	case d.Activated:
		snap.AccountState = "active"
		snap.Capabilities = []string{"direct_ipv6_call", "contacts"}
	}
	return snap, nil
}

// ---- refresh and logout ----

// Refresh rotates a single-use refresh token. Reuse revokes the session lineage. An
// uncertain commit is reported as unavailable so the client keeps its identity material
// and recovers through setup/resume instead of treating it as proof of compromise.
func (s *AuthV2Service) Refresh(ctx context.Context, refreshToken string) (contracts.RefreshResponse, error) {
	next, hint, err := newOpaqueToken()
	if err != nil {
		return contracts.RefreshResponse{}, lifecycleUnavailable()
	}
	user, sessionID, err := s.identity.RotateRefreshToken(ctx, hashOpaqueToken(refreshToken), hashOpaqueToken(next), hint, "", "", s.now().Add(sessionLifetime))
	switch {
	case err == nil:
	case errors.Is(err, repository.ErrRefreshRotationCommitted):
		return contracts.RefreshResponse{}, lifecycleUnavailable()
	case errors.Is(err, pgx.ErrNoRows), errors.Is(err, repository.ErrRefreshTokenReuse):
		return contracts.RefreshResponse{}, apiErr(contracts.CodeSessionInvalid, "Sign in required")
	default:
		return contracts.RefreshResponse{}, lifecycleUnavailable()
	}
	access, err := security.IssueSessionAccessToken(s.cfg.JWTSecret, user.ID, sessionID, user.DeviceID, user.Username, user.Role, user.AccountType, user.PlanCode, user.AuthVersion)
	if err != nil {
		return contracts.RefreshResponse{}, lifecycleUnavailable()
	}
	return contracts.RefreshResponse{AccessToken: access, RefreshToken: next, ExpiresInSeconds: accessTokenSeconds}, nil
}

// Logout revokes the caller's current session. It is idempotent: an already revoked or
// unknown session still succeeds so a retried local sign-out can finish.
func (s *AuthV2Service) Logout(ctx context.Context, principalID, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	err := s.identity.RevokeSession(ctx, principalID, sessionID)
	if err == nil || errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return lifecycleUnavailable()
}
