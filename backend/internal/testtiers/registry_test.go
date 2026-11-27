package testtiers

import (
	"strings"
	"testing"
)

func TestParseAndSelectRegisteredTiers(t *testing.T) {
	registry, err := Parse(strings.NewReader(`{"version":1,"tests":[` +
		`{"package":"pkg/z","name":"TestLow","tier":"Low","reason":"low impact"},` +
		`{"package":"pkg/a","name":"TestCritical","tier":"Critical","reason":"critical impact"},` +
		`{"package":"pkg/a","name":"TestHigh","tier":"High","reason":"high impact"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	selected, err := registry.Select(High, Critical)
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 2 || selected[0].Tier != Critical || selected[1].Tier != High {
		t.Fatalf("unexpected selected tests: %+v", selected)
	}
}

func TestParseRejectsInvalidRegistry(t *testing.T) {
	cases := []string{
		`{"version":2,"tests":[]}`,
		`{"version":1,"tests":[{"package":"p","name":"T","tier":"urgent","reason":"impact"}]}`,
		`{"version":1,"tests":[{"package":"p","name":"T","tier":"Low","reason":"impact"},{"package":"p","name":"T","tier":"Low","reason":"impact"}]}`,
		`{"version":1,"tests":[],"extra":true}`,
		`{"version":1,"tests":[]} {}`,
		`{"version":1,"tests":[]}`,
		`{"version":1,"tests":[{"package":" p","name":"T","tier":"Low","reason":"impact"}]}`,
		`{"version":1,"tests":[{"package":"p","name":"Test../Bad","tier":"Low","reason":"impact"}]}`, 
	}
	for _, input := range cases {
		t.Run(input, func(t *testing.T) {
			if _, err := Parse(strings.NewReader(input)); err == nil {
				t.Fatal("expected invalid registry to fail")
			}
		})
	}
}

func TestSelectRejectsUnknownTier(t *testing.T) {
	registry := Registry{Version: 1}
	if _, err := registry.Select(Tier("Urgent")); err == nil {
		t.Fatal("expected unknown requested tier to fail")
	}
}
