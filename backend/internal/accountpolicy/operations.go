package accountpolicy

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

const (
	IdempotencyRetention = 24 * time.Hour
	FreshAuthMaxAge      = 5 * time.Minute
	UsernameChangeGap    = 30 * 24 * time.Hour
	DeletionWindow       = 7 * 24 * time.Hour
	UnknownRequestTTL    = 10 * time.Minute
	DefaultHistoryDays   = 90
	MinHistoryDays       = 1
	MaxHistoryDays       = 3650
)

var (
	ErrOperationConflict = errors.New("idempotency key reused with a different payload")
	ErrFreshAuthRequired = errors.New("fresh authentication required")
	ErrUsernameCooldown  = errors.New("username changed too recently")
	ErrRetentionRange    = errors.New("history retention out of range")
)

// Fingerprint binds actor, operation and canonical payload for deduplication.
func Fingerprint(actor, operation string, payload []byte) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s|%s|", actor, operation)
	h.Write(payload)
	return hex.EncodeToString(h.Sum(nil))
}

// CheckIdempotency reports whether a repeated key is a replay (true) or a new
// operation (false); a changed fingerprint is a conflict.
func CheckIdempotency(storedFingerprint, fingerprint string, storedAt, now time.Time) (replay bool, err error) {
	if storedFingerprint == "" || now.Sub(storedAt) > IdempotencyRetention {
		return false, nil
	}
	if storedFingerprint != fingerprint {
		return false, ErrOperationConflict
	}
	return true, nil
}

// FreshAuth is a short grant bound to a named operation.
type FreshAuth struct {
	Operation string
	IssuedAt  time.Time
}

func (f FreshAuth) Require(operation string, now time.Time) error {
	if f.Operation != operation || f.IssuedAt.IsZero() || now.Sub(f.IssuedAt) > FreshAuthMaxAge || now.Before(f.IssuedAt) {
		return ErrFreshAuthRequired
	}
	return nil
}

// CheckUsernameChange permits a change once per 30 days. Failed attempts must
// not update lastChange; only a committed change does.
func CheckUsernameChange(lastChange *time.Time, now time.Time) error {
	if lastChange != nil && now.Sub(*lastChange) < UsernameChangeGap {
		return ErrUsernameCooldown
	}
	return nil
}

// DeletionDeadline is the server-side purge time for a deletion request.
func DeletionDeadline(requested time.Time) time.Time { return requested.Add(DeletionWindow) }

// DeletionCancelable reports whether cancellation can still win.
func DeletionCancelable(deadline, now time.Time) bool { return now.Before(deadline) }

// ValidateHistoryRetention checks the versioned policy value.
func ValidateHistoryRetention(days int) error {
	if days < MinHistoryDays || days > MaxHistoryDays {
		return ErrRetentionRange
	}
	return nil
}

// HistoryExpiry assigns expiry at creation so default changes are prospective.
func HistoryExpiry(created time.Time, retentionDays int) time.Time {
	return created.Add(time.Duration(retentionDays) * 24 * time.Hour)
}
