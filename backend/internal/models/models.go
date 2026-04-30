package models

import "time"

type User struct {
	ID           string     `json:"id"`
	Username     string     `json:"username"`
	PasswordHash string     `json:"-"`
	Role         string     `json:"role,omitempty"`
	Status       string     `json:"status"`
	IPAddr       string     `json:"ip_addr"`
	LastSeen     *time.Time `json:"last_seen,omitempty"`
}

type UserPublic struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Status   string `json:"status"`
	IPAddr   string `json:"ip_addr,omitempty"`
}

type RegisterRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginRequest = RegisterRequest

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