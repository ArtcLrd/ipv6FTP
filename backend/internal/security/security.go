package security

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	apperr "ipv6ftp/internal/errors"
)

type TokenClaims struct {
	Sub       string `json:"sub"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
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
