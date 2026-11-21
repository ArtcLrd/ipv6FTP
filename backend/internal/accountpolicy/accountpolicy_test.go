package accountpolicy

import (
	"errors"
	"strings"
	"testing"
	"time"
)

var pepper = []byte("0123456789abcdef0123456789abcdef")

func distinctRunes(start rune, n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteRune(start + rune(i))
	}
	return b.String()
}

func TestPasswordPolicy(t *testing.T) {
	cases := []struct {
		name string
		pw   string
		err  error
	}{
		{"too short", "short pass", ErrPasswordLength},
		{"fourteen", strings.Repeat("a", 14), ErrPasswordLength},
		{"passphrase with spaces", "correct horse battery staple", nil},
		{"unicode counts code points", "éàüöäñçßøåæœïêû", nil},
		{"too many runes", strings.Repeat("a1", 65), ErrPasswordLength},
		{"128 four-byte runes is exactly the byte cap", distinctRunes(0x1F600, 128), nil},
		{"repeated char", strings.Repeat("a", 20), ErrPasswordCommon},
		{"invalid utf8", "\xff\xfe" + strings.Repeat("a", 20), ErrPasswordEncoding},
		{"common short", "password1234567", ErrPasswordCommon},
		{"no composition rules", "alllowercaseletters", nil},
	}
	for _, c := range cases {
		if err := ValidatePassword(c.pw); !errors.Is(err, c.err) {
			t.Errorf("%s: got %v want %v", c.name, err, c.err)
		}
	}
}

func TestUsernameGrammar(t *testing.T) {
	if got, err := ValidateNewUsername("  Alice_01 "); err != nil || got != "alice_01" {
		t.Fatalf("got %q %v", got, err)
	}
	for _, bad := range []string{"ab", strings.Repeat("a", 31), "has space", "dash-name", "ünï", "a.b", ""} {
		if _, err := ValidateNewUsername(bad); !errors.Is(err, ErrUsernameSyntax) {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestRecoverySetGenerateAndVerify(t *testing.T) {
	set, err := GenerateRecoverySet(pepper, nil)
	if err != nil || len(set) != RecoveryCodeCount {
		t.Fatalf("set %d err %v", len(set), err)
	}
	seen := map[string]bool{}
	verifiers := make([]string, len(set))
	for i, c := range set {
		if seen[c.Display] {
			t.Fatal("duplicate code")
		}
		seen[c.Display] = true
		verifiers[i] = c.Verifier
		if strings.Contains(c.Verifier, c.Display) {
			t.Fatal("verifier leaks plaintext")
		}
	}
	for i, c := range set {
		if got := VerifyRecoveryCode(pepper, strings.ToLower(strings.ReplaceAll(c.Display, "-", " ")), verifiers); got != i {
			t.Fatalf("code %d matched %d", i, got)
		}
	}
	if VerifyRecoveryCode(pepper, "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA", verifiers) != -1 {
		t.Fatal("wrong code accepted")
	}
	if VerifyRecoveryCode([]byte("another-pepper-another-pepper-xx"), set[0].Display, verifiers) != -1 {
		t.Fatal("wrong pepper accepted")
	}
	if VerifyRecoveryCode(pepper, "not a code", verifiers) != -1 {
		t.Fatal("malformed accepted")
	}
	if _, err := GenerateRecoverySet([]byte("short"), nil); err == nil {
		t.Fatal("short pepper accepted")
	}
}

func TestEmailChallengeLifecycle(t *testing.T) {
	now := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	code, ch, err := NewEmailChallenge(pepper, "verify", "acct", 1, now, nil)
	if err != nil || len(code) != EmailChallengeDigits {
		t.Fatalf("code %q err %v", code, err)
	}
	if _, err := ch.Check(pepper, "verify", "acct", 2, code, now); !errors.Is(err, ErrChallengeMismatch) {
		t.Fatal("stale address version accepted")
	}
	if _, err := ch.Check(pepper, "recover", "acct", 1, code, now); !errors.Is(err, ErrChallengeMismatch) {
		t.Fatal("wrong purpose accepted")
	}
	if _, err := ch.Check(pepper, "verify", "acct", 1, code, now.Add(11*time.Minute)); !errors.Is(err, ErrChallengeExpired) {
		t.Fatal("expired accepted")
	}
	if _, err := ch.Check(pepper, "verify", "acct", 1, code, now.Add(time.Minute)); err != nil {
		t.Fatalf("valid rejected: %v", err)
	}
	for i := 0; i < EmailChallengeAttempts; i++ {
		ch, _ = ch.Check(pepper, "verify", "acct", 1, "00000000x", now)
	}
	if _, err := ch.Check(pepper, "verify", "acct", 1, code, now); !errors.Is(err, ErrChallengeAttempts) {
		t.Fatal("attempt limit not enforced")
	}
}

func TestResendLimits(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	if err := CheckResend(nil, now); err != nil {
		t.Fatal(err)
	}
	if err := CheckResend([]time.Time{now.Add(-30 * time.Second)}, now); !errors.Is(err, ErrResendCooldown) {
		t.Fatal("cooldown")
	}
	var h []time.Time
	for i := 0; i < ResendPerHour; i++ {
		h = append(h, now.Add(-time.Duration(2+i*10)*time.Minute))
	}
	if err := CheckResend(h, now); !errors.Is(err, ErrResendLimit) {
		t.Fatal("hourly limit")
	}
	var d []time.Time
	for i := 0; i < ResendPerDay; i++ {
		d = append(d, now.Add(-time.Duration(90+i*60)*time.Minute))
	}
	if err := CheckResend(d, now); !errors.Is(err, ErrResendLimit) {
		t.Fatal("daily limit")
	}
}

func TestIdempotency(t *testing.T) {
	now := time.Now()
	fp := Fingerprint("u1", "password", []byte(`{"a":1}`))
	if fp == Fingerprint("u2", "password", []byte(`{"a":1}`)) {
		t.Fatal("actor not bound")
	}
	if r, err := CheckIdempotency("", fp, now, now); r || err != nil {
		t.Fatal("new op")
	}
	if r, err := CheckIdempotency(fp, fp, now, now.Add(time.Hour)); !r || err != nil {
		t.Fatal("replay")
	}
	if _, err := CheckIdempotency(fp, "other", now, now); !errors.Is(err, ErrOperationConflict) {
		t.Fatal("conflict")
	}
	if r, _ := CheckIdempotency(fp, "other", now, now.Add(25*time.Hour)); r {
		t.Fatal("expired key must be treated as new")
	}
}

func TestFreshAuth(t *testing.T) {
	now := time.Now()
	f := FreshAuth{Operation: "password_change", IssuedAt: now}
	if f.Require("password_change", now.Add(4*time.Minute)) != nil {
		t.Fatal("valid rejected")
	}
	if !errors.Is(f.Require("password_change", now.Add(6*time.Minute)), ErrFreshAuthRequired) {
		t.Fatal("stale accepted")
	}
	if !errors.Is(f.Require("delete_account", now), ErrFreshAuthRequired) {
		t.Fatal("wrong operation accepted")
	}
	if !errors.Is(FreshAuth{}.Require("x", now), ErrFreshAuthRequired) {
		t.Fatal("zero grant accepted")
	}
}

func TestUsernameCooldownAndDeletion(t *testing.T) {
	now := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	if CheckUsernameChange(nil, now) != nil {
		t.Fatal("first change")
	}
	recent := now.Add(-29 * 24 * time.Hour)
	if !errors.Is(CheckUsernameChange(&recent, now), ErrUsernameCooldown) {
		t.Fatal("cooldown")
	}
	old := now.Add(-31 * 24 * time.Hour)
	if CheckUsernameChange(&old, now) != nil {
		t.Fatal("after cooldown")
	}
	dl := DeletionDeadline(now)
	if !dl.Equal(now.Add(7*24*time.Hour)) || !DeletionCancelable(dl, dl.Add(-time.Second)) || DeletionCancelable(dl, dl) {
		t.Fatal("deletion window")
	}
}

func TestHistoryRetention(t *testing.T) {
	if ValidateHistoryRetention(0) == nil || ValidateHistoryRetention(MaxHistoryDays+1) == nil || ValidateHistoryRetention(90) != nil {
		t.Fatal("range")
	}
	c := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if !HistoryExpiry(c, 90).Equal(c.AddDate(0, 0, 90)) {
		t.Fatal("expiry")
	}
}
