package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"ipv6ftp/internal/testtiers"
	"ipv6ftp/internal/testutil"
)

type preflight interface{ Check(context.Context) error }
type postgresPreflight struct {
	dsn          string
	fixtureToken string
}

func (p postgresPreflight) Check(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, p.dsn)
	if err != nil {
		return fmt.Errorf("connect preflight: %w", err)
	}
	defer conn.Close(ctx)
	var user, db string
	var canCreateDB, superuser, canCreateRole, replication bool
	var token string
	// Identity, least-privilege attributes, and the bootstrap secret are read
	// together on this exact maintenance connection before lifecycle creation.
	if err := conn.QueryRow(ctx, `SELECT current_user, current_database(), r.rolcreatedb,
		r.rolsuper, r.rolcreaterole, r.rolreplication,
		(SELECT fixture_token FROM public.ipv6ftp_integration_fixture LIMIT 1)
		FROM pg_roles r WHERE r.rolname = current_user`).Scan(&user, &db, &canCreateDB, &superuser, &canCreateRole, &replication, &token); err != nil {
		return fmt.Errorf("verify disposable fixture preflight: %w", err)
	}
	if user != testutil.AutoTestRole || db != "postgres" || !canCreateDB || superuser || canCreateRole || replication || p.fixtureToken == "" || token != p.fixtureToken {
		return errors.New("preflight mismatch: maintenance identity, role attributes, or Docker fixture token is invalid")
	}
	return nil
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		log.Fatal(err)
	}
}

type lifecycle interface {
	Run(context.Context, string, string, func(context.Context, string) error) error
}
type lifecycleRunner struct{}

func (lifecycleRunner) Run(ctx context.Context, dsn, _ string, callback func(context.Context, string) error) error {
	lifecycle, err := testutil.ConnectLifecycle(ctx, dsn)
	if err != nil {
		return err
	}
	defer closeLifecycle(lifecycle)
	return testutil.RunDisposable(ctx, lifecycle, dsn, callback)
}

func closeLifecycle(lifecycle *testutil.PostgresLifecycle) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = lifecycle.Close(ctx)
}

type commandRunner func(context.Context, string, []string, []string, io.Writer) error

type runDependencies struct {
	preflight         func(string) preflight
	lifecycle         lifecycle
	command           commandRunner
	registryPath      string
	maintenanceDSN    func() string
	fixtureToken      func() string
	markerInitializer func(context.Context, string, string) error
}

func run(ctx context.Context, args []string, output io.Writer) error {
	return runWithDependencies(ctx, args, output, runDependencies{
		preflight: func(dsn string) preflight {
			return postgresPreflight{dsn: dsn, fixtureToken: os.Getenv("IPV6FTP_TEST_FIXTURE_TOKEN")}
		},
		lifecycle:         lifecycleRunner{},
		command:           runCommand,
		registryPath:      "testdata/integration-tiers.json",
		maintenanceDSN:    func() string { return os.Getenv("IPV6FTP_TEST_MAINTENANCE_URL") },
		markerInitializer: initializeMarkers,
	})
}
func runWithDependencies(ctx context.Context, args []string, output io.Writer, deps runDependencies) error {
	flags := flag.NewFlagSet("integrationtest", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	tierArg := flags.String("tiers", "Critical,High", "comma-separated tiers (or All)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	var tiers []testtiers.Tier
	if strings.TrimSpace(*tierArg) == "All" {
		tiers = []testtiers.Tier{testtiers.Critical, testtiers.High, testtiers.Medium, testtiers.Low}
	} else {
		seenTiers := make(map[testtiers.Tier]struct{})
		for _, raw := range strings.Split(*tierArg, ",") {
			raw = strings.TrimSpace(raw)
			if raw == "" {
				return errors.New("tier list must not contain empty entries")
			}
			var tier testtiers.Tier
			switch raw {
			case "Critical":
				tier = testtiers.Critical
			case "High":
				tier = testtiers.High
			case "Medium":
				tier = testtiers.Medium
			case "Low":
				tier = testtiers.Low
			default:
				return fmt.Errorf("invalid tier %q", raw)
			}
			if _, duplicate := seenTiers[tier]; duplicate {
				return fmt.Errorf("duplicate tier %q", raw)
			}
			seenTiers[tier] = struct{}{}
			tiers = append(tiers, tier)
		}
	}
	file, err := os.Open(deps.registryPath)
	if err != nil {
		return err
	}
	defer file.Close()
	registry, err := testtiers.Parse(file)
	if err != nil {
		return err
	}
	selected, err := registry.Select(tiers...)
	if err != nil {
		return err
	}
	if len(selected) == 0 {
		return errors.New("no tests selected")
	}
	maintenance := deps.maintenanceDSN()
	if err := testutil.ValidateRunnerDSN(maintenance); err != nil {
		return fmt.Errorf("IPV6FTP_TEST_MAINTENANCE_URL: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	if err := deps.preflight(maintenance).Check(ctx); err != nil {
		return err
	}
	passed := 0
	defer func() {
		_, _ = fmt.Fprintf(output, "integration tests: selected=%d passed=%d\n", len(selected), passed)
	}()
	return deps.lifecycle.Run(ctx, maintenance, maintenance, func(ctx context.Context, target string) error {
		marker, err := randomMarker()
		if err != nil {
			return err
		}
		if err := deps.command(ctx, "go", []string{"run", "./cmd/migrate", "up", "--allow-destructive-reset", "--isolated-env"}, migrationEnv(target), output); err != nil {
			return fmt.Errorf("isolated migration failed: %w", err)
		}
		// The per-run startup marker belongs only to ipv6test and is initialized after migrations.
		if err := deps.markerInitializer(ctx, target, marker); err != nil {
			return err
		}
		for _, test := range selected {
			if _, err := fmt.Fprintf(output, "[%s] %s %s\n", test.Tier, test.Package, test.Name); err != nil {
				return err
			}
			args := []string{"test", "-json", "-tags=integration", "./" + test.Package, "-run", "^" + test.Name + "$", "-count=1", "-p=1"}
			testEnv := append(os.Environ(), "IPV6FTP_ISOLATED_TEST_DATABASE_URL="+target, "INTEGRATION_STARTUP_MARKER="+marker)
			var events strings.Builder
			commandErr := deps.command(ctx, "go", args, testEnv, &events)
			if _, err := io.WriteString(output, events.String()); err != nil {
				return err
			}
			if commandErr != nil {
				return fmt.Errorf("test %s/%s failed: %w", test.Package, test.Name, commandErr)
			}
			if err := requireTestPassed(events.String(), test.Name); err != nil {
				return fmt.Errorf("test %s/%s: %w", test.Package, test.Name, err)
			}
			passed++
		}
		return nil
	})
}

func migrationEnv(target string) []string {
	// Reuse the parent's Go caches without inheriting its database configuration.
	env := []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + os.Getenv("HOME"),
		"MIGRATOR_DATABASE_URL=" + target,
		"GOTOOLCHAIN=local",
		"GOPROXY=off",
		"GOWORK=off",
	}
	for _, key := range []string{"GOPATH", "GOMODCACHE", "GOCACHE"} {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func requireTestPassed(raw, selectedName string) error {
	decoder := json.NewDecoder(strings.NewReader(raw))
	passed := false
	for {
		var event struct {
			Action string `json:"Action"`
			Test   string `json:"Test"`
		}
		if err := decoder.Decode(&event); err != nil {
			if err == io.EOF {
				break
			}
			return fmt.Errorf("malformed go test JSON event: %w", err)
		}
		if event.Test == selectedName {
			if event.Action == "pass" {
				passed = true
			} else if event.Action == "fail" || event.Action == "skip" {
				return fmt.Errorf("selected test reported %s", event.Action)
			}
		}
	}
	if !passed {
		return errors.New("selected test has no observed pass event")
	}
	return nil
}

func runCommand(ctx context.Context, executable string, args, env []string, output io.Writer) error {
	cmd := exec.CommandContext(ctx, executable, args...)
	cmd.Env = env
	cmd.Stdout, cmd.Stderr = output, output
	return cmd.Run()
}

func randomMarker() (string, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	return fmt.Sprintf("%x", b), nil
}
func initializeMarkers(ctx context.Context, target, marker string) error {
	c, e := pgx.Connect(ctx, target)
	if e != nil {
		return e
	}
	defer c.Close(ctx)
	if _, e = c.Exec(ctx, "CREATE TABLE public.integration_startup_marker(marker text NOT NULL)"); e != nil {
		return e
	}
	_, e = c.Exec(ctx, "INSERT INTO public.integration_startup_marker(marker) VALUES($1)", marker)
	return e
}
