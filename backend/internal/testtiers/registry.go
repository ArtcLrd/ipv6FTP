// Package testtiers loads and selects integration tests from the repository tier registry.
package testtiers

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
)

type Tier string

const (
	Critical Tier = "Critical"
	High     Tier = "High"
	Medium   Tier = "Medium"
	Low      Tier = "Low"
)

type TestCase struct {
	Package string `json:"package"`
	Name    string `json:"name"`
	Tier    Tier   `json:"tier"`
	Reason  string `json:"reason"`
}

type Registry struct {
	Version int        `json:"version"`
	Tests   []TestCase `json:"tests"`
}

var tierOrder = map[Tier]int{Critical: 0, High: 1, Medium: 2, Low: 3}

// Parse validates a versioned registry, including unique package/test identities.
func Parse(r io.Reader) (Registry, error) {
	decoder := json.NewDecoder(r)
	decoder.DisallowUnknownFields()
	var registry Registry
	if err := decoder.Decode(&registry); err != nil {
		return Registry{}, fmt.Errorf("decode tier registry: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return Registry{}, fmt.Errorf("tier registry must contain exactly one JSON value")
	}
	if registry.Version != 1 {
		return Registry{}, fmt.Errorf("unsupported tier registry version %d", registry.Version)
	}
	if len(registry.Tests) == 0 {
		return Registry{}, fmt.Errorf("tier registry must contain at least one test")
	}
	seen := make(map[string]struct{}, len(registry.Tests))
	for _, test := range registry.Tests {
		key := test.Package + "/" + test.Name
		if strings.TrimSpace(test.Package) == "" || strings.TrimSpace(test.Name) == "" || strings.TrimSpace(test.Package) != test.Package || strings.TrimSpace(test.Name) != test.Name {
			return Registry{}, fmt.Errorf("test package and name must be non-empty and trimmed")
		}
		if strings.HasPrefix(test.Package, "/") || strings.Contains(test.Package, "..") || strings.ContainsAny(test.Package, "\\\\") || strings.ContainsAny(test.Name, "/^$\\\\") {
			return Registry{}, fmt.Errorf("test %s has invalid package or test name", key)
		}
		if _, ok := tierOrder[test.Tier]; !ok {
			return Registry{}, fmt.Errorf("test %s has invalid tier %q", key, test.Tier)
		}
		if strings.TrimSpace(test.Reason) == "" {
			return Registry{}, fmt.Errorf("test %s must include an impact reason", key)
		}
		if _, ok := seen[key]; ok {
			return Registry{}, fmt.Errorf("duplicate test %s", key)
		}
		seen[key] = struct{}{}
	}
	return registry, nil
}

// Select returns cases in requested tiers, ordered by tier then package and test name.
func (registry Registry) Select(tiers ...Tier) ([]TestCase, error) {
	selected := make(map[Tier]struct{}, len(tiers))
	for _, tier := range tiers {
		if _, ok := tierOrder[tier]; !ok {
			return nil, fmt.Errorf("invalid requested tier %q", tier)
		}
		selected[tier] = struct{}{}
	}
	result := make([]TestCase, 0)
	for _, test := range registry.Tests {
		if _, ok := selected[test.Tier]; ok {
			result = append(result, test)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if tierOrder[result[i].Tier] != tierOrder[result[j].Tier] {
			return tierOrder[result[i].Tier] < tierOrder[result[j].Tier]
		}
		if result[i].Package != result[j].Package {
			return result[i].Package < result[j].Package
		}
		return result[i].Name < result[j].Name
	})
	return result, nil
}
