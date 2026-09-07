package models

import "time"

type User struct {
	ID             string             `json:"id"`
	Username       string             `json:"username"`
	AccountType    string             `json:"account_type,omitempty"`
	PlanCode       string             `json:"plan_code,omitempty"`
	AuthVersion    int                `json:"auth_version,omitempty"`
	DeviceID       string             `json:"device_installation_id,omitempty"`
	Roles          []string           `json:"roles,omitempty"`
	Permissions    []string           `json:"permissions,omitempty"`
	Capabilities   map[string]any     `json:"capabilities,omitempty"`
	PendingPrompts []ConversionPrompt `json:"pending_prompts,omitempty"`
	PasswordHash   string             `json:"-"`
	Role           string             `json:"role,omitempty"`
	Status         string             `json:"status"`
	IPAddr         string             `json:"ip_addr"`
	LastSeen       *time.Time         `json:"last_seen,omitempty"`
	TrialExpires   *time.Time         `json:"trial_expires_at,omitempty"`
}

type AuthorizationContext struct {
	PrincipalID string   `json:"principal_id"`
	AccountType string   `json:"account_type"`
	Status      string   `json:"status"`
	AuthVersion int      `json:"auth_version"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"permissions"`
	PlanCode    string   `json:"plan_code"`
}

type ConversionPrompt struct {
	Code                  string     `json:"code"`
	Reason                string     `json:"reason"`
	TriggerPeriodKey      string     `json:"trigger_period_key"`
	SnoozeDurationSeconds int        `json:"snooze_duration_seconds,omitempty"`
	DueAt                 *time.Time `json:"due_at,omitempty"`
}

type PromptActionRequest struct {
	Code             string `json:"code"`
	TriggerPeriodKey string `json:"trigger_period_key,omitempty"`
	Action           string `json:"action"`
}

type CallDeniedDetails struct {
	ReasonCode               string `json:"reason_code"`
	QuotaPolicyID            string `json:"quota_policy_id,omitempty"`
	QuotaPeriodID            string `json:"quota_period_id,omitempty"`
	RemainingSeconds         int    `json:"remaining_seconds"`
	ResetAt                  string `json:"reset_at,omitempty"`
	EligibleConversionPrompt string `json:"eligible_conversion_prompt,omitempty"`
}

type UserPublic struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Status   string `json:"status"`
	IPAddr   string `json:"ip_addr,omitempty"`
}

type RegisterRequest struct {
	Username     string                     `json:"username"`
	Password     string                     `json:"password"`
	Email        string                     `json:"email,omitempty"`
	GuestID      string                     `json:"guest_principal_id,omitempty"`
	Installation *DeviceInstallationRequest `json:"installation,omitempty"`
}

type LoginRequest struct {
	Username     string                     `json:"username"`
	Password     string                     `json:"password"`
	GuestID      string                     `json:"guest_principal_id,omitempty"`
	Installation *DeviceInstallationRequest `json:"installation,omitempty"`
}

type GuestBootstrapRequest struct {
	Installation DeviceInstallationRequest `json:"installation"`
}

type DeviceInstallationRequest struct {
	IdentifierHash string `json:"identifier_hash"`
	PublicKey      string `json:"public_key,omitempty"`
	Platform       string `json:"platform,omitempty"`
	AppInstanceID  string `json:"app_instance_id,omitempty"`
}

type Contact struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Status    string `json:"status"`
	IPAddr    string `json:"ip_addr"`
	Direction string `json:"direction"`
}

type RoomInviteRequest struct {
	ContactID string `json:"contact_id"`
	RoomID    string `json:"room_id"`
	Type      string `json:"type"`
}

type CallInvitationRequest struct {
	MediaType     string `json:"media_type,omitempty"`
	NetworkFamily string `json:"network_family,omitempty"`
}

type CallInvitation struct {
	CallSessionID  string     `json:"call_session_id"`
	ParticipantID  string     `json:"participant_id"`
	InvitationID   string     `json:"invitation_id"`
	LinkToken      string     `json:"link_token"`
	JoinURL        string     `json:"join_url,omitempty"`
	FallbackCode   string     `json:"fallback_code"`
	PolicyMode     string     `json:"policy_mode"`
	AllowedSeconds *int       `json:"allowed_seconds,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
}

type JoinCallRequest struct {
	Token string `json:"token,omitempty"`
	Code  string `json:"code,omitempty"`
}

type JoinCallResponse struct {
	CallSessionID  string `json:"call_session_id"`
	ParticipantID  string `json:"participant_id"`
	MediaType      string `json:"media_type"`
	NetworkFamily  string `json:"network_family"`
	PolicyMode     string `json:"policy_mode"`
	AllowedSeconds *int   `json:"allowed_seconds,omitempty"`
}

type CallSignalAuthorization struct {
	CallSessionID  string `json:"call_session_id"`
	ParticipantID  string `json:"participant_id"`
	MediaType      string `json:"media_type"`
	NetworkFamily  string `json:"network_family"`
	CallStatus     string `json:"call_status"`
	AllowedSeconds *int   `json:"allowed_seconds,omitempty"`
}

type CallUsageToday struct {
	MediaType        string `json:"media_type"`
	NetworkFamily    string `json:"network_family"`
	DurationSeconds  int64  `json:"duration_seconds"`
	RemainingSeconds *int64 `json:"remaining_seconds,omitempty"`
}

type HeartbeatRequest struct {
	PublicKey string `json:"public_key"`
	IPv6      string `json:"ipv6_address"`
	IPv4      string `json:"ipv4_address"`
	Online    bool   `json:"is_online"`
}

type ResolvedAddress struct {
	UserID         string     `json:"user_id"`
	Username       string     `json:"username"`
	IPv6Address    *string    `json:"ipv6_address,omitempty"`
	IPv4Address    *string    `json:"ipv4_address,omitempty"`
	IsIPv6Active   bool       `json:"is_ipv6_active"`
	IsIPv4Fallback bool       `json:"is_ipv4_fallback"`
	LastSeen       *time.Time `json:"last_seen,omitempty"`
	IsOnline       bool       `json:"is_online"`
	PublicKey      string     `json:"public_key"`
}

type Session struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	TokenHash string    `json:"-"`
	UserAgent string    `json:"user_agent,omitempty"`
	IPAddr    string    `json:"ip_addr,omitempty"`
	ExpiresAt time.Time `json:"expires_at"`
	Revoked   bool      `json:"is_revoked"`
}
