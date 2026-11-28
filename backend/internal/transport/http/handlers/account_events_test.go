package handlers

import "testing"

func TestAccountEventCursorParsing(t *testing.T) {
	for _, n := range []int64{0, 1, 9223372036854775807} {
		value := encodeEventCursor(n)
		if parsed, err := parseEventCursor(value); err != nil || parsed != n {
			t.Errorf("cursor %q: %d %v", value, parsed, err)
		}
	}
	for _, value := range []string{"", "00", "-1", "1.0", "//////////8", "AAAAAAAAAAA=", "AAAAAAAAAAB"} {
		if _, err := parseEventCursor(value); err == nil {
			t.Errorf("accepted invalid cursor %q", value)
		}
	}
}

func TestAccountEventResumeBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name         string
		sequence     int64
		retained     bool
		payloadBytes int
		resync       bool
	}{
		{"next retained", 8, true, 4096, false},
		{"duplicate or stale", 7, true, 2, true},
		{"missing event", 9, true, 2, true},
		{"expired event", 8, false, 2, true},
		{"oversized payload", 8, true, 4097, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := accountEventNeedsResync(8, tc.sequence, tc.retained, tc.payloadBytes); got != tc.resync {
				t.Fatalf("resync=%v, want %v", got, tc.resync)
			}
		})
	}
}
