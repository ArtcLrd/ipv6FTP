package contracts

import (
	"encoding/base64"
	"regexp"

	"ipv6ftp/internal/accountpolicy"
)

// Auth and enrollment contracts (M2). See docs/voice-architecture/user-management-contracts-v2.md
// section 2. Binary values are unpadded base64url.

var keyIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func b64Len(s string, min, max int) bool {
	b, err := base64.RawURLEncoding.DecodeString(s)
	return err == nil && len(b) >= min && len(b) <= max
}

// Bounds for the Noise IK handshake frames carried in JSON. Message 1 is at least
// 96 bytes (ephemeral + encrypted static + two tags) and carries no payload.
const (
	MinHandshake1Bytes = 96
	MaxHandshakeBytes  = MinHandshake1Bytes
	MinHandshake2Bytes = 48
	// MaxHandshake2Bytes covers ephemeral + tag + the encrypted session grant.
	MaxHandshake2Bytes = 4096
	NonceBytes         = 32
	PublicKeyBytes     = 32
)

// RegisteredBeginRequest creates an account in setup_pending. It issues no session.
type RegisteredBeginRequest struct {
	Username      string `json:"username"`
	Password      string `json:"password"`
	SchemaVersion int    `json:"schema_version"`
}

func (r *RegisteredBeginRequest) Validate() error {
	if r.SchemaVersion != 2 {
		return invalid("schema_version")
	}
	if _, err := accountpolicy.ValidateNewUsername(r.Username); err != nil {
		return err
	}
	return accountpolicy.ValidatePassword(r.Password)
}

// SetupResumeRequest re-authenticates with the password to obtain a new setup grant.
// It serves incomplete registrations and new-phone sign-in alike and never creates an account.
type SetupResumeRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (r *SetupResumeRequest) Validate() error {
	if r.Username == "" || len(r.Username) > 64 || r.Password == "" || len(r.Password) > accountpolicy.MaxPasswordBytes {
		return invalid("setup_resume")
	}
	return nil
}

type SetupGrantResponse struct {
	SetupGrant       string `json:"setup_grant"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
}

func (r *SetupGrantResponse) Validate() error {
	if r.SetupGrant == "" || len(r.SetupGrant) > 512 || r.ExpiresInSeconds < 1 || r.ExpiresInSeconds > 900 {
		return invalid("setup_grant")
	}
	return nil
}

type EnrollChallengeRequest struct {
	RotationSupported bool   `json:"rotation_supported,omitempty"`
	SetupGrant        string `json:"setup_grant"`
}

func (r *EnrollChallengeRequest) Validate() error {
	if r.SetupGrant == "" || len(r.SetupGrant) > 512 {
		return invalid("setup_grant")
	}
	return nil
}

type EnrollChallengeResponse struct {
	ChallengeID      string `json:"challenge_id"`
	PrincipalID      string `json:"principal_id"`
	Nonce            string `json:"nonce"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
	ServerKeyID      string `json:"server_key_id"`
}

func (r *EnrollChallengeResponse) Validate() error {
	if !uuidPattern.MatchString(r.ChallengeID) || !uuidPattern.MatchString(r.PrincipalID) || !b64Len(r.Nonce, NonceBytes, NonceBytes) ||
		r.ExpiresInSeconds < 1 || r.ExpiresInSeconds > 300 || !keyIDPattern.MatchString(r.ServerKeyID) {
		return invalid("challenge")
	}
	return nil
}

type EnrollFinishRequest struct {
	ChallengeID string `json:"challenge_id"`
	Handshake   string `json:"handshake"`
}

func (r *EnrollFinishRequest) Validate() error {
	if !uuidPattern.MatchString(r.ChallengeID) || !b64Len(r.Handshake, MinHandshake1Bytes, MaxHandshakeBytes) {
		return invalid("enroll_finish")
	}
	return nil
}

type EnrollFinishResponse struct {
	Handshake string `json:"handshake"`
}

func (r *EnrollFinishResponse) Validate() error {
	if !b64Len(r.Handshake, MinHandshake2Bytes, MaxHandshake2Bytes) {
		return invalid("handshake")
	}
	return nil
}

// SessionGrant is the plaintext carried inside Noise message 2. Only the holder of the
// enrolled device's static private key can decrypt it.
type SessionGrant struct {
	RotationSigner   string `json:"rotation_signer,omitempty"`
	PrincipalID      string `json:"principal_id"`
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
	SessionID        string `json:"session_id"`
	DeviceID         string `json:"device_id"`
	Generation       int64  `json:"generation"`
	AccountState     string `json:"account_state"`
}

func (g *SessionGrant) Validate() error {
	if g.AccessToken == "" || len(g.AccessToken) > 2048 || len(g.RefreshToken) < 16 || len(g.RefreshToken) > 512 ||
		g.ExpiresInSeconds < 1 || !uuidPattern.MatchString(g.PrincipalID) || !uuidPattern.MatchString(g.SessionID) || !uuidPattern.MatchString(g.DeviceID) ||
		g.Generation < 1 || !accountStates[g.AccountState] {
		return invalid("session_grant")
	}
	return nil
}

type EnrollmentRotationMetadata struct {
	Signer    string `json:"signer"`
	Signature string `json:"signature"`
	Epoch     uint32 `json:"epoch"`
}

type ServerKeyResponse struct {
	Rotation  *EnrollmentRotationMetadata `json:"rotation,omitempty"`
	KeyID     string                      `json:"key_id"`
	PublicKey string                      `json:"public_key"`
}

func (r *ServerKeyResponse) Validate() error {
	if !keyIDPattern.MatchString(r.KeyID) || !b64Len(r.PublicKey, PublicKeyBytes, PublicKeyBytes) {
		return invalid("server_key")
	}
	return nil
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func (r *RefreshRequest) Validate() error {
	if len(r.RefreshToken) < 16 || len(r.RefreshToken) > 512 {
		return invalid("refresh_token")
	}
	return nil
}

type RefreshResponse struct {
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
}

func (r *RefreshResponse) Validate() error {
	if r.AccessToken == "" || len(r.AccessToken) > 2048 || len(r.RefreshToken) < 16 || len(r.RefreshToken) > 512 || r.ExpiresInSeconds < 1 {
		return invalid("refresh")
	}
	return nil
}
