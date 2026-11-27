// Command schema-baseline generates a schema-only reference after restoring it
// into a separately provisioned disposable database and verifying exact parity.
package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

var errUnsafeTarget = errors.New("refusing database: disposable fixture name/comment mismatch")

const (
	fixtureName = "ipv6test_schema_source"
	fixtureMark = "ipv6ftp-schema-baseline-source"
	restoreName = "ipv6test_schema_restore"
	restoreMark = "ipv6ftp-schema-baseline-restore"
)

type command struct {
	name  string
	args  []string
	stdin []byte
	env   []string
}

const maxCommandStderr = 4096

var runCommand = func(c command) ([]byte, error) {
	cmd := exec.Command(c.name, c.args...)
	cmd.Stdin = bytes.NewReader(c.stdin)
	cmd.Env = append(os.Environ(), "DATABASE_URL=")
	for _, e := range c.env {
		cmd.Env = append(cmd.Env, e)
	}
	output, err := cmd.Output()
	if err == nil {
		return output, nil
	}
	var stderr []byte
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		stderr = exitErr.Stderr
	}
	return output, commandFailure(stderr, err)
}

func commandFailure(stderr []byte, err error) error {
	detail := strings.TrimSpace(string(stderr))
	if len(detail) > maxCommandStderr {
		detail = detail[:maxCommandStderr] + " [truncated]"
	}
	if detail == "" {
		return fmt.Errorf("command failed: %w", err)
	}
	return fmt.Errorf("command failed: %s: %w", detail, err)
}

func normalizeDump(dump []byte) []byte {
	lines := bytes.Split(dump, []byte("\n"))
	footerStart := len(lines)
	for i := len(lines) - 3; i >= 0; i-- {
		if dumpBanner(lines, i) && bytes.Equal(lines[i+1], []byte("-- PostgreSQL database dump complete")) {
			footerStart = i
			break
		}
	}
	// pg_dump brackets each section heading with bare '--' lines. Keep the
	// opening separator with its own heading, and keep the footer out of the
	// last sortable section so it doesn't follow whichever object emitted last.
	prefixEnd, start := footerStart, -1
	blocks := make([][]byte, 0)
	for i := 0; i < footerStart; i++ {
		if !dumpSectionStart(lines[:footerStart], i) {
			continue
		}
		if start == -1 {
			prefixEnd = i
		} else {
			blocks = append(blocks, bytes.TrimSpace(bytes.Join(lines[start:i], []byte("\n"))))
		}
		start = i
	}
	if start != -1 {
		blocks = append(blocks, bytes.TrimSpace(bytes.Join(lines[start:footerStart], []byte("\n"))))
	}
	sort.Slice(blocks, func(i, j int) bool { return bytes.Compare(blocks[i], blocks[j]) < 0 })
	parts := append([][]byte{normalizeDumpEnvelope(lines[:prefixEnd])}, blocks...)
	parts = append(parts, normalizeDumpEnvelope(lines[footerStart:]))
	return bytes.TrimSpace(bytes.Join(parts, []byte("\n\n")))
}

func dumpBanner(lines [][]byte, i int) bool {
	return i+2 < len(lines) && bytes.Equal(lines[i], []byte("--")) && bytes.Equal(lines[i+2], []byte("--"))
}

func dumpSectionStart(lines [][]byte, i int) bool {
	return dumpBanner(lines, i) && bytes.HasPrefix(lines[i+1], []byte("-- Name: "))
}

func normalizeDumpEnvelope(lines [][]byte) []byte {
	var kept [][]byte
	for _, line := range lines {
		if bytes.HasPrefix(line, []byte("-- Dumped from database version ")) || bytes.HasPrefix(line, []byte("-- Dumped by pg_dump version ")) ||
			bytes.HasPrefix(line, []byte("-- Started on ")) || bytes.HasPrefix(line, []byte("-- Completed on ")) ||
			bytes.HasPrefix(line, []byte("\\restrict ")) || bytes.HasPrefix(line, []byte("\\unrestrict ")) {
			continue
		}
		kept = append(kept, line)
	}
	return bytes.TrimSpace(bytes.Join(kept, []byte("\n")))
}

func schemaDumpArgs(database string) []string {
	return []string{"--no-password", "--schema-only", "--no-owner", "--format=plain", "--dbname", database}
}

func sectionCounts(dump []byte) map[string]int {
	counts := make(map[string]int)
	lines := bytes.Split(dump, []byte("\n"))
	for i := range lines {
		if dumpSectionStart(lines, i) {
			counts[string(lines[i+1])]++
		}
	}
	return counts
}

func parityDifference(source, restored []byte) string {
	normalizedSource, normalizedRestored := normalizeDump(source), normalizeDump(restored)
	if bytes.Equal(normalizedSource, normalizedRestored) {
		return ""
	}

	sourceSections, restoredSections := sectionCounts(normalizedSource), sectionCounts(normalizedRestored)
	var missing, unexpected []string
	for header, count := range sourceSections {
		if restoredSections[header] < count {
			missing = append(missing, fmt.Sprintf("%s (source=%d restored=%d)", header, count, restoredSections[header]))
		}
	}
	for header, count := range restoredSections {
		if sourceSections[header] < count {
			unexpected = append(unexpected, fmt.Sprintf("%s (source=%d restored=%d)", header, sourceSections[header], count))
		}
	}
	sort.Strings(missing)
	sort.Strings(unexpected)
	if len(missing) > 0 || len(unexpected) > 0 {
		return fmt.Sprintf("section headers differ; missing from restored: %v; unexpected in restored: %v", missing, unexpected)
	}
	return firstDifference(normalizedSource, normalizedRestored)
}

func firstDifference(source, restored []byte) string {
	a, b := bytes.Split(source, []byte("\n")), bytes.Split(restored, []byte("\n"))
	for i := 0; i < len(a) || i < len(b); i++ {
		var left, right []byte
		if i < len(a) {
			left = a[i]
		}
		if i < len(b) {
			right = b[i]
		}
		if !bytes.Equal(left, right) {
			return fmt.Sprintf("%d (source=%q restored=%q)", i+1, left, right)
		}
	}
	return ""
}
func atomicReplace(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".schema-baseline-*.sql")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
func verify(service, name, mark string) error {
	q := "SELECT current_database() || E'\\t' || COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = current_database()"
	b, err := runCommand(command{"psql", []string{"--no-psqlrc", "--no-password", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--dbname", name, "--command", q}, nil, []string{"PGSERVICE=" + service}})
	if err != nil {
		return errors.New("database identity verification failed")
	}
	if strings.TrimSpace(string(b)) != name+"\t"+mark {
		return errUnsafeTarget
	}
	return nil
}
func run(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("schema-baseline", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	check := fs.Bool("check", false, "offline marker check")
	generate := fs.Bool("generate", false, "generate after disposable restore/parity validation")
	confirm := fs.String("confirm-token", "", "must equal IPV6FTP_SCHEMA_BASELINE_CONFIRM")
	sourceEnv := fs.String("source-dsn-env", "IPV6FTP_SCHEMA_BASELINE_SOURCE_DSN", "source fixture DSN environment variable")
	restoreEnv := fs.String("restore-dsn-env", "IPV6FTP_SCHEMA_BASELINE_RESTORE_DSN", "restore fixture DSN environment variable")
	output := fs.String("output", "db/schema/baseline.sql", "baseline output")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if *check {
		if *generate {
			return errors.New("--check and --generate are mutually exclusive")
		}
		b, e := os.ReadFile(*output)
		if e != nil {
			return e
		}
		if !bytes.Contains(b, []byte("NOT GENERATED")) {
			return errors.New("baseline status marker missing")
		}
		_, e = fmt.Fprintln(out, "baseline NOT GENERATED; offline marker check only")
		return e
	}
	if !*generate {
		return errors.New("no action: pass --check or explicit --generate")
	}
	if *confirm == "" || *confirm != os.Getenv("IPV6FTP_SCHEMA_BASELINE_CONFIRM") {
		return errors.New("explicit confirmation token mismatch")
	}
	if filepath.Clean(*output) != filepath.Clean("db/schema/baseline.sql") {
		return errors.New("output is restricted to db/schema/baseline.sql")
	}
	source, restore := os.Getenv(*sourceEnv), os.Getenv(*restoreEnv)
	if source == "" || restore == "" {
		return errors.New("source and restore libpq service names are required")
	}
	if strings.ContainsAny(source+restore, "/:@?=\\\\") {
		return errors.New("service names must be simple identifiers")
	}
	for _, tool := range []string{"psql", "pg_dump"} {
		if _, e := exec.LookPath(tool); e != nil {
			return fmt.Errorf("required PostgreSQL tool %s not found in PATH", tool)
		}
	}
	return generateBaseline(source, restore, filepath.Clean(*output), out)
}

func generateBaseline(source, restore, path string, out io.Writer) error {
	if err := verify(source, fixtureName, fixtureMark); err != nil {
		return err
	}
	if err := verify(restore, restoreName, restoreMark); err != nil {
		return err
	}
	dump, err := runCommand(command{"pg_dump", schemaDumpArgs(fixtureName), nil, []string{"PGSERVICE=" + source}})
	if err != nil {
		return errors.New("source schema dump failed")
	}
	if len(bytes.TrimSpace(dump)) == 0 || bytes.Contains(dump, []byte("NOT GENERATED")) {
		return errors.New("source schema dump empty or invalid")
	}
	// The harness supplies a fresh template-created target. In particular,
	// pg_dump may omit CREATE SCHEMA public and expect that schema to exist.
	if _, err = runCommand(command{"psql", []string{"--no-psqlrc", "--no-password", "--set", "ON_ERROR_STOP=1", "--single-transaction", "--file=-", "--dbname", restoreName}, dump, []string{"PGSERVICE=" + restore}}); err != nil {
		return fmt.Errorf("schema restore failed: %w", err)
	}
	restored, err := runCommand(command{"pg_dump", schemaDumpArgs(restoreName), nil, []string{"PGSERVICE=" + restore}})
	if err != nil {
		return errors.New("restored schema dump failed")
	}
	if diff := parityDifference(dump, restored); diff != "" {
		return fmt.Errorf("restored schema parity mismatch: %s; baseline unchanged", diff)
	}
	current, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if !bytes.Contains(current, []byte("NOT GENERATED")) {
		return errors.New("refusing to overwrite baseline without NOT GENERATED placeholder")
	}
	if err = atomicReplace(path, dump); err != nil {
		return fmt.Errorf("atomically replace baseline: %w", err)
	}
	_, err = fmt.Fprintf(out, "schema-only baseline generated at %s after restore parity verification\n", path)
	return err
}
func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}
