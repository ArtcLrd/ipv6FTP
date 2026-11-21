// Package contracts defines the /api/v2 account request and response shapes,
// strict decoding and validation. Matching Zod schemas live in
// frontend/src/core/api/contractsV2.ts; both sides test against the shared
// fixtures in backend/testdata/contracts/v2.
package contracts

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"ipv6ftp/internal/accountpolicy"
)

// MaxBodyBytes bounds every v2 JSON request.
const MaxBodyBytes = 16 * 1024

// Error codes. Only CodeAccessExpired may trigger a client refresh.
const (
	CodeValidationFailed  = "validation_failed"
	CodeAccessExpired     = "access_expired"
	CodeSessionInvalid    = "session_invalid"
	CodeForbidden         = "forbidden"
	CodeRestricted        = "restricted"
	CodeNotFound          = "not_found"
	CodeConflict          = "conflict"
	CodeOperationConflict = "operation_conflict"
	CodePendingOperation  = "pending_operation"
	CodeQuotaExhausted    = "quota_exhausted"
	CodeRateLimited       = "rate_limited"
	CodeUnavailable       = "unavailable"
	CodeUpgradeRequired   = "upgrade_required"
)

var errorStatus = map[string]int{
	CodeValidationFailed:  http.StatusBadRequest,
	CodeAccessExpired:     http.StatusUnauthorized,
	CodeSessionInvalid:    http.StatusUnauthorized,
	CodeForbidden:         http.StatusForbidden,
	CodeRestricted:        http.StatusForbidden,
	CodeNotFound:          http.StatusNotFound,
	CodeConflict:          http.StatusConflict,
	CodeOperationConflict: http.StatusConflict,
	CodePendingOperation:  http.StatusConflict,
	CodeQuotaExhausted:    http.StatusTooManyRequests,
	CodeRateLimited:       http.StatusTooManyRequests,
	CodeUnavailable:       http.StatusServiceUnavailable,
	CodeUpgradeRequired:   http.StatusUpgradeRequired,
}

// StatusFor returns the HTTP status for a code, or 500 for an unknown one.
func StatusFor(code string) int {
	if s, ok := errorStatus[code]; ok {
		return s
	}
	return http.StatusInternalServerError
}

type ErrorBody struct {
	Code              string  `json:"code"`
	Message           string  `json:"message"`
	RetryAfterSeconds *int    `json:"retry_after_seconds,omitempty"`
	ResetAt           *string `json:"reset_at,omitempty"`
}

type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

func (e *ErrorEnvelope) Validate() error {
	if _, ok := errorStatus[e.Error.Code]; !ok || e.Error.Message == "" {
		return invalid("error")
	}
	if e.Error.RetryAfterSeconds != nil && *e.Error.RetryAfterSeconds < 0 {
		return invalid("retry_after_seconds")
	}
	if e.Error.ResetAt != nil {
		if _, err := time.Parse(time.RFC3339, *e.Error.ResetAt); err != nil {
			return invalid("reset_at")
		}
	}
	return nil
}

var (
	ErrBodyTooLarge   = errors.New("request body too large")
	ErrTrailingData   = errors.New("trailing data after JSON body")
	ErrMethodNotAllow = errors.New("method not allowed")
	ErrInvalid        = errors.New("invalid request")
)

// Decode reads exactly one JSON value into dst, rejecting oversize bodies,
// unknown fields and trailing data. Wrong methods are rejected first.
func Decode(r *http.Request, method string, dst any) error {
	if r.Method != method {
		return ErrMethodNotAllow
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, MaxBodyBytes+1))
	if err != nil {
		return err
	}
	return DecodeBytes(raw, dst)
}

// DecodeBytes is the transport-independent core, used directly by fixture tests.
func DecodeBytes(raw []byte, dst any) error {
	if len(raw) > MaxBodyBytes {
		return ErrBodyTooLarge
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return ErrTrailingData
	}
	if v, ok := dst.(interface{ Validate() error }); ok {
		return v.Validate()
	}
	return nil
}

var (
	uuidPattern  = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	emailPattern = regexp.MustCompile(`^[^@\s]{1,64}@[^@\s]{1,255}$`)
	digitsOnly   = regexp.MustCompile(`^[0-9]{8}$`)
)

func invalid(reason string) error { return errors.Join(ErrInvalid, errors.New(reason)) }

func checkEmail(e string) error {
	if len(e) > 254 || !emailPattern.MatchString(e) || !strings.Contains(e[strings.LastIndex(e, "@"):], ".") {
		return invalid("email")
	}
	return nil
}

// FreshAuthRequest obtains a short grant bound to one named operation.
type FreshAuthRequest struct {
	Password  string `json:"password"`
	Operation string `json:"operation"`
}

var freshOps = map[string]bool{"password_change": true, "email_change": true, "recovery_codes": true, "username_change": true, "delete_account": true, "cancel_deletion": true}

func (r *FreshAuthRequest) Validate() error {
	if r.Password == "" || len(r.Password) > accountpolicy.MaxPasswordBytes || !freshOps[r.Operation] {
		return invalid("reauth")
	}
	return nil
}

type PasswordChangeRequest struct {
	FreshAuthGrant string `json:"fresh_auth_grant"`
	NewPassword    string `json:"new_password"`
}

func (r *PasswordChangeRequest) Validate() error {
	if r.FreshAuthGrant == "" || len(r.FreshAuthGrant) > 512 {
		return invalid("grant")
	}
	return accountpolicy.ValidatePassword(r.NewPassword)
}

type RecoveryBeginRequest struct {
	// Method is "saved_code" or "email". Email recovery identifies the
	// account by verified address, so Identifier is an email there and the
	// current username for saved-code recovery.
	Method     string `json:"method"`
	Identifier string `json:"identifier"`
}

func (r *RecoveryBeginRequest) Validate() error {
	switch r.Method {
	case "saved_code":
		// Historical handles may predate the new grammar, so only bound length.
		if strings.TrimSpace(r.Identifier) == "" || len(r.Identifier) > 64 {
			return invalid("identifier")
		}
	case "email":
		return checkEmail(r.Identifier)
	default:
		return invalid("method")
	}
	return nil
}

type RecoveryProveRequest struct {
	RecoveryID string `json:"recovery_id"`
	Code       string `json:"code"`
}

func (r *RecoveryProveRequest) Validate() error {
	// recovery_id is an opaque server-signed token, not a UUID, so unknown and known accounts look alike.
	if len(r.RecoveryID) < 16 || len(r.RecoveryID) > 512 || len(r.Code) < 8 || len(r.Code) > 64 {
		return invalid("recovery_proof")
	}
	return nil
}

type RecoveryCompleteRequest struct {
	RecoveryGrant string `json:"recovery_grant"`
	NewPassword   string `json:"new_password"`
}

func (r *RecoveryCompleteRequest) Validate() error {
	if r.RecoveryGrant == "" || len(r.RecoveryGrant) > 512 {
		return invalid("grant")
	}
	return accountpolicy.ValidatePassword(r.NewPassword)
}

// RecoveryCodesRequest regenerates the saved-code set and needs fresh authentication.
type RecoveryCodesRequest struct {
	FreshAuthGrant string `json:"fresh_auth_grant"`
}

func (r *RecoveryCodesRequest) Validate() error {
	if r.FreshAuthGrant == "" || len(r.FreshAuthGrant) > 512 {
		return invalid("grant")
	}
	return nil
}

// EmptyRequest is for operations whose input is only the authenticated session.
type EmptyRequest struct{}

// RecoveryAckRequest binds acknowledgement to a code in the displayed set.
type RecoveryAckRequest struct {
	Code string `json:"code"`
}

func (r *RecoveryAckRequest) Validate() error {
	if _, err := accountpolicy.ParseRecoveryCode(r.Code); err != nil {
		return invalid("code")
	}
	return nil
}

type EmailChallengeRequest struct {
	FreshAuthGrant string `json:"fresh_auth_grant"`
	Email          string `json:"email"`
}

func (r *EmailChallengeRequest) Validate() error {
	if r.FreshAuthGrant == "" || len(r.FreshAuthGrant) > 512 {
		return invalid("grant")
	}
	return checkEmail(r.Email)
}

type EmailVerifyRequest struct {
	ChallengeID string `json:"challenge_id"`
	Code        string `json:"code"`
}

func (r *EmailVerifyRequest) Validate() error {
	if !uuidPattern.MatchString(r.ChallengeID) || !digitsOnly.MatchString(r.Code) {
		return invalid("challenge")
	}
	return nil
}

type UsernameChangeRequest struct {
	FreshAuthGrant string `json:"fresh_auth_grant"`
	Username       string `json:"username"`
}

func (r *UsernameChangeRequest) Validate() error {
	if r.FreshAuthGrant == "" || len(r.FreshAuthGrant) > 512 {
		return invalid("grant")
	}
	if _, err := accountpolicy.ValidateNewUsername(r.Username); err != nil {
		return err
	}
	return nil
}

type DeletionRequest struct {
	FreshAuthGrant string `json:"fresh_auth_grant"`
	Confirm        bool   `json:"confirm"`
}

func (r *DeletionRequest) Validate() error {
	if r.FreshAuthGrant == "" || len(r.FreshAuthGrant) > 512 || !r.Confirm {
		return invalid("deletion")
	}
	return nil
}

// ---- responses ----

type RecoveryBeginResponse struct {
	RecoveryID string `json:"recovery_id"`
}

func (r *RecoveryBeginResponse) Validate() error {
	if len(r.RecoveryID) < 16 || len(r.RecoveryID) > 512 {
		return invalid("recovery_id")
	}
	return nil
}

type RecoveryProveResponse struct {
	RecoveryGrant string `json:"recovery_grant"`
}

func (r *RecoveryProveResponse) Validate() error {
	if r.RecoveryGrant == "" || len(r.RecoveryGrant) > 512 {
		return invalid("grant")
	}
	return nil
}

// RecoveryCodesResponse carries a freshly generated set, shown once.
type RecoveryCodesResponse struct {
	RecoveryCodes []string `json:"recovery_codes"`
}

func (r *RecoveryCodesResponse) Validate() error {
	if len(r.RecoveryCodes) != accountpolicy.RecoveryCodeCount {
		return invalid("recovery_codes")
	}
	for _, c := range r.RecoveryCodes {
		if len(c) < 16 || len(c) > 64 {
			return invalid("recovery_codes")
		}
	}
	return nil
}

// RecoveryCompleteResponse returns the replacement code set; it never contains tokens.
type RecoveryCompleteResponse = RecoveryCodesResponse

type FreshAuthResponse struct {
	FreshAuthGrant   string `json:"fresh_auth_grant"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
}

func (r *FreshAuthResponse) Validate() error {
	max := int(accountpolicy.FreshAuthMaxAge.Seconds())
	if r.FreshAuthGrant == "" || len(r.FreshAuthGrant) > 512 || r.ExpiresInSeconds < 1 || r.ExpiresInSeconds > max {
		return invalid("fresh_auth")
	}
	return nil
}

type EmailChallengeResponse struct {
	ChallengeID string `json:"challenge_id"`
}

func (r *EmailChallengeResponse) Validate() error {
	if !uuidPattern.MatchString(r.ChallengeID) {
		return invalid("challenge_id")
	}
	return nil
}

// BootstrapSnapshot is the revisioned authorized snapshot (response).
type BootstrapSnapshot struct {
	Eligibility          *BootstrapEligibility `json:"eligibility,omitempty"`
	ResetAt              *string               `json:"reset_at,omitempty"`
	Reminder             *BootstrapReminder    `json:"reminder,omitempty"`
	DeletionDeadline     *string               `json:"deletion_deadline,omitempty"`
	EventCursor          *string               `json:"event_cursor,omitempty"`
	DeviceKeyFingerprint string                `json:"device_key_fingerprint,omitempty"`
	SchemaVersion        int                   `json:"schema_version"`
	Revision             int64                 `json:"revision"`
	PrincipalID          string                `json:"principal_id"`
	DeviceID             string                `json:"device_id"`
	SessionID            string                `json:"session_id"`
	Generation           int64                 `json:"generation"`
	Username             string                `json:"username"`
	AccountType          string                `json:"account_type"`
	AccountState         string                `json:"account_state"`
	Capabilities         []string              `json:"capabilities"`
	PolicyVersion        int                   `json:"policy_version"`
}

type BootstrapEligibility struct {
	AllServicesGated *bool `json:"all_services_gated"`
	AllowedSeconds   *int  `json:"allowed_seconds,omitempty"`
}
type BootstrapReminder struct {
	Code             string `json:"code"`
	Reason           string `json:"reason"`
	TriggerPeriodKey string `json:"trigger_period_key"`
}

var (
	accountTypes  = map[string]bool{"registered": true, "guest": true}
	accountStates = map[string]bool{"setup_pending": true, "recovery_setup": true, "active": true, "restricted": true, "pending_deletion": true}
)

func (s *BootstrapSnapshot) Validate() error {
	for _, value := range []*string{s.ResetAt, s.DeletionDeadline} {
		if value != nil {
			if _, err := time.Parse(time.RFC3339, *value); err != nil {
				return invalid("snapshot timestamp")
			}
		}
	}
	if s.Eligibility != nil && (s.Eligibility.AllServicesGated == nil || s.Eligibility.AllowedSeconds != nil && *s.Eligibility.AllowedSeconds < 0) {
		return invalid("eligibility")
	}
	if s.Reminder != nil && (s.Reminder.Code == "" || s.Reminder.Reason == "" || s.Reminder.TriggerPeriodKey == "") {
		return invalid("reminder")
	}
	if s.EventCursor != nil && (len(*s.EventCursor) == 0 || len(*s.EventCursor) > 512) {
		return invalid("cursor")
	}
	if s.DeviceKeyFingerprint != "" && !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(s.DeviceKeyFingerprint) {
		return invalid("fingerprint")
	}
	if s.SchemaVersion != 2 || s.Revision < 0 || s.Generation < 0 || s.PolicyVersion < 0 ||
		!uuidPattern.MatchString(s.PrincipalID) || !uuidPattern.MatchString(s.DeviceID) || !uuidPattern.MatchString(s.SessionID) ||
		s.Username == "" || len(s.Username) > 64 || !accountTypes[s.AccountType] || !accountStates[s.AccountState] || len(s.Capabilities) > 32 {
		return invalid("snapshot")
	}
	return nil
}

// ---- profile lifecycle (M4) ----

// SessionRevokeRequest revokes one of the caller's own sessions.
type SessionRevokeRequest struct {
	SessionID string `json:"session_id"`
}

func (r *SessionRevokeRequest) Validate() error {
	if !uuidPattern.MatchString(r.SessionID) {
		return invalid("session_id")
	}
	return nil
}

// DeletionCancelRequest proves the password directly because deletion has already
// revoked every session, so there is no session to authenticate the request.
type DeletionCancelRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (r *DeletionCancelRequest) Validate() error {
	if r.Username == "" || len(r.Username) > 64 || r.Password == "" || len(r.Password) > accountpolicy.MaxPasswordBytes {
		return invalid("cancel")
	}
	return nil
}

type ProfileResponse struct {
	Username             string  `json:"username"`
	Revision             int64   `json:"revision"`
	AccountState         string  `json:"account_state"`
	RecoveryAcknowledged bool    `json:"recovery_acknowledged"`
	NextUsernameChangeAt *string `json:"next_username_change_at"`
}

type UsernameAvailabilityResponse struct {
	Available bool `json:"available"`
}

type DeletionStatusResponse struct {
	State    string  `json:"state"`
	Deadline *string `json:"deadline"`
}

type SessionItem struct {
	SessionID string  `json:"session_id"`
	DeviceID  string  `json:"device_id"`
	IssuedAt  string  `json:"issued_at"`
	ExpiresAt string  `json:"expires_at"`
	Current   bool    `json:"current"`
	RevokedAt *string `json:"revoked_at"`
}

type SessionsResponse struct {
	Sessions []SessionItem `json:"sessions"`
}
