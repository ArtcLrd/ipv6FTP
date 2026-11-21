// Package accountpolicy holds side-effect-free account rules from the
// user-management plan: password and username policy, recovery codes, email
// challenges, idempotency fingerprints and retention validation. It performs
// no I/O so every rule can be unit tested without a database.
package accountpolicy

import (
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	MinPasswordRunes = 15
	MaxPasswordRunes = 128
	MaxPasswordBytes = 512
	MinUsernameLen   = 3
	MaxUsernameLen   = 30
)

var (
	ErrPasswordLength    = errors.New("password must be 15-128 characters")
	ErrPasswordBytes     = errors.New("password exceeds 512 bytes")
	ErrPasswordEncoding  = errors.New("password is not valid UTF-8")
	ErrPasswordCommon    = errors.New("password is too common or compromised")
	ErrUsernameSyntax    = errors.New("username must be 3-30 lowercase letters, digits or underscore")
	usernamePattern      = regexp.MustCompile(`^[a-z0-9_]{3,30}$`)
	commonPasswordSubstr = []string{"password", "qwerty", "123456789", "letmein", "iloveyou", "admin"}
)

// ValidatePassword enforces the length-only policy: no composition rules and
// spaces allowed. A blocklist rejects trivially common values; callers may add
// a compromised-password screening hook on top.
func ValidatePassword(p string) error {
	if !utf8.ValidString(p) {
		return ErrPasswordEncoding
	}
	n := utf8.RuneCountInString(p)
	if n < MinPasswordRunes || n > MaxPasswordRunes {
		return ErrPasswordLength
	}
	if len(p) > MaxPasswordBytes {
		return ErrPasswordBytes
	}
	if IsCommonPassword(p) {
		return ErrPasswordCommon
	}
	return nil
}

// IsCommonPassword rejects single repeated characters, obvious sequences and
// values dominated by well-known weak strings.
func IsCommonPassword(p string) bool {
	lower := strings.ToLower(strings.TrimSpace(p))
	if lower == "" {
		return true
	}
	runes := []rune(lower)
	allSame := true
	for _, r := range runes {
		if r != runes[0] {
			allSame = false
			break
		}
	}
	if allSame {
		return true
	}
	for _, s := range commonPasswordSubstr {
		if strings.Contains(lower, s) && utf8.RuneCountInString(lower) < len(s)+8 {
			return true
		}
	}
	return false
}

// CanonicalUsername lowercases and trims; it does not validate.
func CanonicalUsername(u string) string { return strings.ToLower(strings.TrimSpace(u)) }

// ValidateNewUsername applies the grammar to newly chosen names only. Existing
// historical handles keep login access through reviewed compatibility mapping.
func ValidateNewUsername(u string) (string, error) {
	c := CanonicalUsername(u)
	if !usernamePattern.MatchString(c) {
		return "", ErrUsernameSyntax
	}
	return c, nil
}
