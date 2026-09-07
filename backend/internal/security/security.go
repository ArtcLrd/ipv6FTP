package security

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	apperr "ipv6ftp/internal/errors"
)

type TokenClaims struct {
	Sub         string `json:"sub"`
	SessionID   string `json:"sid,omitempty"`
	DeviceID    string `json:"did,omitempty"`
	Username    string `json:"username"`
	Role        string `json:"role"`
	AccountType string `json:"account_type,omitempty"`
	PlanCode    string `json:"plan_code,omitempty"`
	AuthVersion int    `json:"auth_version,omitempty"`
	TokenType   string `json:"token_type"`
	jwt.RegisteredClaims
}

func IssueAccessToken(secret []byte, userID, username, role, accountType, planCode string) (string, error) {
	if role == "" {
		role = "app_user"
	}
	claims := &TokenClaims{
		Sub:         userID,
		Username:    username,
		Role:        role,
		AccountType: accountType,
		PlanCode:    planCode,
		TokenType:   "access",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

func IssueSessionAccessToken(secret []byte, userID, sessionID, deviceID, username, role, accountType, planCode string, authVersion int) (string, error) {
	if role == "" {
		role = "app_user"
	}
	if authVersion <= 0 {
		authVersion = 1
	}
	now := time.Now()
	claims := &TokenClaims{
		Sub:         userID,
		SessionID:   sessionID,
		DeviceID:    deviceID,
		Username:    username,
		Role:        role,
		AccountType: accountType,
		PlanCode:    planCode,
		AuthVersion: authVersion,
		TokenType:   "access",
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        randomJTI(),
			ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    "ipv6ftp-api",
			Audience:  []string{"ipv6ftp-native"},
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

func IssueTokenPair(secret []byte, userID, username, role string) (string, string, error) {
	if role == "" {
		role = "user"
	}
	accessClaims := &TokenClaims{
		Sub:       userID,
		Username:  username,
		Role:      role,
		TokenType: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims).SignedString(secret)
	if err != nil {
		return "", "", err
	}

	refreshClaims := &TokenClaims{
		Sub:       userID,
		Username:  username,
		Role:      role,
		TokenType: "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	refreshToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims).SignedString(secret)
	if err != nil {
		return "", "", err
	}
	return accessToken, refreshToken, nil
}

func randomJTI() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func ParseToken(secret []byte, tokenStr, expectType string) (*TokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &TokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		return secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*TokenClaims)
	if !ok || !token.Valid {
		return nil, apperr.ErrUnauthorized
	}
	if claims.TokenType != expectType {
		return nil, apperr.ErrUnauthorized
	}
	return claims, nil
}

func ClientIP(r *http.Request) string {
	remoteAddr := r.RemoteAddr
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		remoteAddr = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	} else if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
		remoteAddr = realIP
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	return strings.Trim(host, "[]")
}

func IsIPv6(ip string) bool { return strings.Contains(ip, ":") }

// Deprecated: Expo/native clients use Authorization Bearer tokens, not cookies.
func SetAuthCookies(w http.ResponseWriter, access, refresh string, environment string) {}

// Deprecated: Expo/native clients use Authorization Bearer tokens, not cookies.
func ClearAuthCookies(w http.ResponseWriter) {}

func ClaimsFromContext(ctx context.Context) *TokenClaims {
	claims, _ := ctx.Value(claimsContextKey{}).(*TokenClaims)
	return claims
}

type claimsContextKey struct{}

func contextWithClaims(ctx context.Context, claims *TokenClaims) context.Context {
	return context.WithValue(ctx, claimsContextKey{}, claims)
}
