package accountpolicy

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

const (
	RecoveryCodeCount = 10
	recoveryCodeBytes = 16 // 128 bits

	EmailChallengeDigits   = 8
	EmailChallengeLifetime = 10 * time.Minute
	EmailChallengeAttempts = 5
	ResendCooldown         = 60 * time.Second
	ResendPerHour          = 5
	ResendPerDay           = 10
)

var (
	ErrRecoveryCodeFormat = errors.New("malformed recovery code")
	ErrChallengeExpired   = errors.New("challenge expired")
	ErrChallengeAttempts  = errors.New("too many attempts")
	ErrChallengeMismatch  = errors.New("code mismatch")
	ErrResendCooldown     = errors.New("resend cooldown active")
	ErrResendLimit        = errors.New("resend limit reached")

	recoveryEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)
)

// RecoveryCode is a displayed code plus the verifier to persist. The plaintext
// is shown once and must never be logged or stored.
type RecoveryCode struct {
	Display  string
	Verifier string
}

// GenerateRecoverySet returns ten independent random 128-bit codes.
func GenerateRecoverySet(pepper []byte, rnd io.Reader) ([]RecoveryCode, error) {
	if rnd == nil {
		rnd = rand.Reader
	}
	if len(pepper) < 16 {
		return nil, errors.New("recovery pepper too short")
	}
	out := make([]RecoveryCode, 0, RecoveryCodeCount)
	for i := 0; i < RecoveryCodeCount; i++ {
		raw := make([]byte, recoveryCodeBytes)
		if _, err := io.ReadFull(rnd, raw); err != nil {
			return nil, err
		}
		out = append(out, RecoveryCode{Display: groupCode(recoveryEncoding.EncodeToString(raw)), Verifier: RecoveryVerifier(pepper, raw)})
	}
	return out, nil
}

// RecoveryVerifier is a keyed hash. Full-entropy secrets do not need a slow KDF.
func RecoveryVerifier(pepper, raw []byte) string {
	m := hmac.New(sha256.New, pepper)
	m.Write([]byte("recovery-code-v1"))
	m.Write(raw)
	return hex.EncodeToString(m.Sum(nil))
}

// ParseRecoveryCode accepts case-insensitive input with spaces or dashes.
func ParseRecoveryCode(s string) ([]byte, error) {
	s = strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(s)))
	raw, err := recoveryEncoding.DecodeString(s)
	if err != nil || len(raw) != recoveryCodeBytes {
		return nil, ErrRecoveryCodeFormat
	}
	return raw, nil
}

// VerifyRecoveryCode compares in constant time against stored verifiers and
// returns the matching index, or -1.
func VerifyRecoveryCode(pepper []byte, input string, verifiers []string) int {
	raw, err := ParseRecoveryCode(input)
	if err != nil {
		return -1
	}
	want := RecoveryVerifier(pepper, raw)
	match := -1
	for i, v := range verifiers {
		if subtle.ConstantTimeCompare([]byte(want), []byte(v)) == 1 {
			match = i
		}
	}
	return match
}

func groupCode(s string) string {
	var parts []string
	for len(s) > 0 {
		n := 4
		if len(s) < n {
			n = len(s)
		}
		parts = append(parts, s[:n])
		s = s[n:]
	}
	return strings.Join(parts, "-")
}

// EmailChallenge is the persisted state of one verification challenge.
type EmailChallenge struct {
	Verifier  string
	ExpiresAt time.Time
	Attempts  int
}

// NewEmailChallenge creates an eight-digit code bound to purpose, owner and address version.
func NewEmailChallenge(pepper []byte, purpose, owner string, addressVersion int, now time.Time, rnd io.Reader) (string, EmailChallenge, error) {
	if rnd == nil {
		rnd = rand.Reader
	}
	var code string
	for len(code) < EmailChallengeDigits {
		b := make([]byte, 1)
		if _, err := io.ReadFull(rnd, b); err != nil {
			return "", EmailChallenge{}, err
		}
		if b[0] < 250 { // reject to avoid modulo bias
			code += fmt.Sprintf("%d", b[0]%10)
		}
	}
	return code, EmailChallenge{Verifier: challengeMAC(pepper, purpose, owner, addressVersion, code), ExpiresAt: now.Add(EmailChallengeLifetime)}, nil
}

// Check validates an attempt and returns the updated challenge. A failed
// attempt always consumes one try; callers persist the returned state.
func (c EmailChallenge) Check(pepper []byte, purpose, owner string, addressVersion int, code string, now time.Time) (EmailChallenge, error) {
	if now.After(c.ExpiresAt) {
		return c, ErrChallengeExpired
	}
	if c.Attempts >= EmailChallengeAttempts {
		return c, ErrChallengeAttempts
	}
	c.Attempts++
	want := challengeMAC(pepper, purpose, owner, addressVersion, code)
	if subtle.ConstantTimeCompare([]byte(want), []byte(c.Verifier)) != 1 {
		return c, ErrChallengeMismatch
	}
	return c, nil
}

func challengeMAC(pepper []byte, purpose, owner string, version int, code string) string {
	m := hmac.New(sha256.New, pepper)
	fmt.Fprintf(m, "email-challenge-v1|%s|%s|%d|%s", purpose, owner, version, code)
	return hex.EncodeToString(m.Sum(nil))
}

// CheckResend enforces cooldown plus hourly and daily issue limits given the
// timestamps of earlier issues in the same purpose and scope.
func CheckResend(issues []time.Time, now time.Time) error {
	var hour, day int
	var last time.Time
	for _, t := range issues {
		if t.After(last) {
			last = t
		}
		if now.Sub(t) < time.Hour {
			hour++
		}
		if now.Sub(t) < 24*time.Hour {
			day++
		}
	}
	if !last.IsZero() && now.Sub(last) < ResendCooldown {
		return ErrResendCooldown
	}
	if hour >= ResendPerHour || day >= ResendPerDay {
		return ErrResendLimit
	}
	return nil
}
