package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"ipv6ftp/internal/testutil"
)

type fakeLifecycle struct {
	exists           bool
	created, dropped bool
}

func (f *fakeLifecycle) Run(ctx context.Context, dsn, _ string, fn func(context.Context, string) error) error {
	if f.exists {
		return testutil.ErrDatabaseExists
	}
	f.created = true
	defer func() { f.dropped = true }()
	return fn(ctx, "postgres://target/ipv6test")
}

type fakePreflight struct {
	err    error
	called bool
}

func (f *fakePreflight) Check(context.Context) error { f.called = true; return f.err }

const maintenanceTestDSN = "postgres://ipv6ftp_auto_test@127.0.0.1:5432/postgres"

func dependencies(t *testing.T, lc *fakeLifecycle) (runDependencies, *[]string, *[][]string) {
	t.Helper()
	registry, err := os.ReadFile(filepath.Join("..", "..", "testdata", "integration-tiers.json"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "tiers.json")
	if err := os.WriteFile(path, registry, 0600); err != nil {
		t.Fatal(err)
	}
	var commands []string
	var envs [][]string
	deps := runDependencies{registryPath: path, maintenanceDSN: func() string { return maintenanceTestDSN }, lifecycle: lc,
		markerInitializer: func(context.Context, string, string) error { return nil },
		preflight:         func(string) preflight { return &fakePreflight{} }, command: func(_ context.Context, _ string, args, env []string, output io.Writer) error {
			commands = append(commands, strings.Join(args, " "))
			envs = append(envs, env)
			if len(args) > 0 && args[0] == "test" {
				name := strings.TrimSuffix(strings.TrimPrefix(args[5], "^"), "$")
				_, _ = fmt.Fprintf(output, `{"Action":"pass","Test":%q}`+"\n", name)
			}
			return nil
		}}
	return deps, &commands, &envs
}

func TestRequireTestPassedRequiresWellFormedPassEvent(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		wantErr   bool
	}{
		{"pass", `{"Action":"pass","Test":"TestExample"}` + "\n", false},
		{"missing", `{"Action":"run","Test":"TestExample"}` + "\n", true},
		{"malformed", `{"Action":`, true},
		{"wrong test", `{"Action":"pass","Test":"Other"}` + "\n", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := requireTestPassed(tc.raw, "TestExample")
			if (err != nil) != tc.wantErr {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestRunPreflightBeforeMigrationAndFixedDatabaseProtection(t *testing.T) {
	lc := &fakeLifecycle{}
	deps, commands, _ := dependencies(t, lc)
	called := &fakePreflight{err: errors.New("fixture mismatch")}
	deps.preflight = func(string) preflight { return called }
	if err := runWithDependencies(context.Background(), []string{"-tiers", "Critical"}, io.Discard, deps); err == nil {
		t.Fatal("expected preflight refusal")
	}
	if len(*commands) != 0 || lc.created || !called.called {
		t.Fatalf("preflight did not block lifecycle: commands=%v created=%v called=%v", *commands, lc.created, called.called)
	}
	lc = &fakeLifecycle{exists: true}
	deps, commands, _ = dependencies(t, lc)
	if err := runWithDependencies(context.Background(), []string{"-tiers", "Critical"}, io.Discard, deps); !errors.Is(err, testutil.ErrDatabaseExists) {
		t.Fatalf("got %v", err)
	}
	if len(*commands) != 0 {
		t.Fatalf("migration ran for existing database: %v", *commands)
	}
}

func TestRunRejectsTierAndSelectedTestsUseIsolatedMigrationEnv(t *testing.T) {
	for _, args := range [][]string{{"-tiers", "bogus"}, {"-tiers", ""}, {"-tiers", "Critical,,High"}, {"-tiers", "High,High"}} {
		deps, commands, _ := dependencies(t, &fakeLifecycle{})
		if err := runWithDependencies(context.Background(), args, io.Discard, deps); err == nil {
			t.Fatalf("accepted %v", args)
		}
		if len(*commands) != 0 {
			t.Fatalf("commands for invalid tiers: %v", *commands)
		}
	}
	t.Setenv("GOPATH", "/go")
	t.Setenv("GOMODCACHE", "/go/pkg/mod")
	t.Setenv("GOCACHE", "/cache/go-build")
	t.Setenv("GOTOOLCHAIN", "auto")
	t.Setenv("GOPROXY", "https://proxy.golang.org")
	t.Setenv("GOWORK", "/workspace/go.work")
	for _, key := range []string{"DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL", "MIGRATOR_DATABASE_URL", "IPV6FTP_TEST_MAINTENANCE_URL", "IPV6FTP_ISOLATED_TEST_DATABASE_URL"} {
		t.Setenv(key, "postgres://parent/unused")
	}
	lc := &fakeLifecycle{}
	deps, commands, envs := dependencies(t, lc)
	if err := runWithDependencies(context.Background(), []string{"-tiers", "Critical"}, io.Discard, deps); err != nil {
		t.Fatal(err)
	}
	if len(*commands) < 2 || !strings.Contains((*commands)[1], "-run ^") {
		t.Fatalf("selected test invocation absent: %v", *commands)
	}
	wantEnv := []string{
		"PATH=" + os.Getenv("PATH"), "HOME=" + os.Getenv("HOME"),
		"MIGRATOR_DATABASE_URL=postgres://target/ipv6test",
		"GOPATH=/go", "GOMODCACHE=/go/pkg/mod", "GOCACHE=/cache/go-build",
		"GOTOOLCHAIN=local", "GOPROXY=off", "GOWORK=off",
	}
	gotEnv := (*envs)[0]
	slices.Sort(gotEnv)
	slices.Sort(wantEnv)
	if !slices.Equal(gotEnv, wantEnv) {
		t.Fatal("migration environment does not match the isolated Go tooling allowlist")
	}
	if !lc.dropped {
		t.Fatal("lifecycle cleanup not invoked")
	}
}
func TestRunAllTiersReportsExactSelectionAndPassCount(t *testing.T) {
	lc := &fakeLifecycle{}
	deps, commands, _ := dependencies(t, lc)
	var output strings.Builder
	if err := runWithDependencies(context.Background(), []string{"-tiers", "All"}, &output, deps); err != nil {
		t.Fatal(err)
	}
	if len(*commands) != 4 { // one migration and all three registered tests
		t.Fatalf("all tiers did not select every registry entry: %v", *commands)
	}
	if !strings.Contains(output.String(), "integration tests: selected=3 passed=3") {
		t.Fatalf("missing exact result summary: %s", output.String())
	}
}

func TestRunMissingOrSkippedJSONEventFailsAndReportsCounts(t *testing.T) {
	for _, event := range []string{`{"Action":"run","Test":"TestPostgresRegisteredEnrollment"}`, `{"Action":"skip","Test":"TestPostgresRegisteredEnrollment"}`} {
		lc := &fakeLifecycle{}
		deps, _, _ := dependencies(t, lc)
		deps.command = func(_ context.Context, _ string, args, _ []string, output io.Writer) error {
			if args[0] == "test" {
				_, _ = io.WriteString(output, event+"\n")
			}
			return nil
		}
		var output strings.Builder
		err := runWithDependencies(context.Background(), []string{"-tiers", "Critical"}, &output, deps)
		if err == nil {
			t.Fatalf("accepted event %s", event)
		}
		if !strings.Contains(output.String(), "selected=1 passed=0") {
			t.Fatalf("missing failure summary: %s", output.String())
		}
		if !lc.dropped {
			t.Fatal("failed run did not clean up")
		}
	}
}

func TestRunFailureStillCleansUp(t *testing.T) {
	lc := &fakeLifecycle{}
	deps, _, _ := dependencies(t, lc)
	deps.command = func(_ context.Context, _ string, args, _ []string, _ io.Writer) error {
		if strings.Contains(strings.Join(args, " "), "./cmd/migrate") {
			return errors.New("migration failure")
		}
		return nil
	}
	if err := runWithDependencies(context.Background(), []string{"-tiers", "Critical"}, io.Discard, deps); err == nil {
		t.Fatal("expected failure")
	}
	if !lc.dropped {
		t.Fatal("cleanup not invoked after failure")
	}
}
