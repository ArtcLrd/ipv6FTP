package testutil

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestVerifyMarkers(t *testing.T) {
	token := strings.Repeat("a", 64)
	for _, tc := range []struct {
		name, token, database string
		fail                  bool
	}{
		{"valid", token, token, false},
		{"missing token", "", token, true},
		{"bad token", strings.Repeat("z", 64), token, true},
		{"wrong database marker", token, "wrong", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			err := verifyMarkers(context.Background(), tc.token, func(_ context.Context) (string, error) {
				calls++
				return tc.database, nil
			})
			if calls > 1 {
				t.Fatal("verification queried more than the test database")
			}
			if (err != nil) != tc.fail {
				t.Fatal("unexpected verification result")
			}
		})
	}
	if verifyMarkers(context.Background(), token, func(context.Context) (string, error) {
		return "", errors.New("query failed")
	}) == nil {
		t.Fatal("query error accepted")
	}
}
