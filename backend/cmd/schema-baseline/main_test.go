package main

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestSchemaDumpArgsIncludePrivilegesAndKeepSchemaOnly(t *testing.T) {
	for _, database := range []string{fixtureName, restoreName} {
		args := schemaDumpArgs(database)
		joined := strings.Join(args, " ")
		if strings.Contains(joined, "--no-privileges") {
			t.Fatalf("dump args for %s exclude ACLs: %v", database, args)
		}
		for _, want := range []string{"--schema-only", "--no-owner", "--dbname " + database} {
			if !strings.Contains(joined, want) {
				t.Fatalf("dump args for %s missing %q: %v", database, want, args)
			}
		}
	}
}

func TestNormalizeDumpIgnoresVolatileMetadata(t *testing.T) {
	a := []byte("-- Dumped from database version 18.4\n-- Dumped by pg_dump version 18.4\n-- Started on 2026-01-01 10:00:00 UTC\n\\restrict random-a\nCREATE TABLE t(id int);\n-- Completed on 2026-01-01 10:00:01 UTC\n\\unrestrict random-a\n")
	b := []byte("-- Dumped from database version 17.2\n-- Dumped by pg_dump version 17.2\n-- Started on 2027-02-02 11:00:00 UTC\n\\restrict random-b\nCREATE TABLE t(id int);\n-- Completed on 2027-02-02 11:00:01 UTC\n\\unrestrict random-b\n")
	if !bytes.Equal(normalizeDump(a), normalizeDump(b)) {
		t.Fatal("volatile dump metadata differs")
	}
	if bytes.Equal(normalizeDump(a), normalizeDump(bytes.Replace(b, []byte("CREATE TABLE t"), []byte("CREATE TABLE other"), 1))) {
		t.Fatal("normalization erased a schema difference")
	}
}
func dumpSection(name, sql string) string {
	return "--\n-- Name: " + name + "\n--\n\n" + sql + "\n\n"
}

func plainDump(sections ...string) []byte {
	return []byte("--\n-- PostgreSQL database dump\n--\n\n\\restrict fixture\n\nSET statement_timeout = 0;\n\n" +
		strings.Join(sections, "\n") + "\n--\n-- PostgreSQL database dump complete\n--\n\n\\unrestrict fixture\n")
}

func TestNormalizeDumpIgnoresObjectSectionOrdering(t *testing.T) {
	extension := dumpSection("btree_gist; Type: EXTENSION; Schema: -; Owner: -", "CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;")
	table := dumpSection("schema_migrations; Type: TABLE; Schema: public; Owner: -", "CREATE TABLE public.schema_migrations (version bigint);")
	source := plainDump(extension, table)
	restored := plainDump(table, extension)
	if !bytes.Equal(normalizeDump(source), normalizeDump(restored)) {
		t.Fatalf("independent dump section ordering should not affect parity: source=%q restored=%q", normalizeDump(source), normalizeDump(restored))
	}
	normalized := normalizeDump(source)
	if !bytes.HasSuffix(normalized, []byte("--\n-- PostgreSQL database dump complete\n--")) {
		t.Fatalf("dump footer must remain last: %q", normalized)
	}
	changed := bytes.Replace(restored, []byte("WITH SCHEMA public"), []byte("WITH SCHEMA private"), 1)
	if bytes.Equal(normalizeDump(source), normalizeDump(changed)) {
		t.Fatal("section sorting erased a schema change")
	}
}
func TestNormalizeDumpPreservesAllSectionsAndDuplicates(t *testing.T) {
	section := dumpSection("account_audit_pkey; Type: CONSTRAINT; Schema: iam; Owner: -", "ALTER TABLE ONLY iam.account_audit ADD CONSTRAINT account_audit_pkey PRIMARY KEY (id);")
	dump := plainDump(section, section, dumpSection("SCHEMA public; Type: COMMENT; Schema: -; Owner: -", "COMMENT ON SCHEMA public IS 'kept';"))
	normalized := normalizeDump(dump)
	if bytes.Count(normalized, []byte("account_audit_pkey; Type: CONSTRAINT")) != 2 {
		t.Fatalf("duplicate sections lost: %q", normalized)
	}
	if !bytes.Contains(normalized, []byte("COMMENT ON SCHEMA public IS 'kept'")) {
		t.Fatalf("section content lost: %q", normalized)
	}
}

func TestParityDifferenceReportsMissingHeadersAndDuplicates(t *testing.T) {
	section := dumpSection("account_audit_pkey; Type: CONSTRAINT; Schema: iam; Owner: -", "ALTER TABLE ONLY iam.account_audit ADD CONSTRAINT account_audit_pkey PRIMARY KEY (id);")
	source := plainDump(section, section)
	restored := plainDump(dumpSection("custom; Type: SCHEMA; Schema: -; Owner: -", "CREATE SCHEMA custom;"))
	got := parityDifference(source, restored)
	for _, want := range []string{"account_audit_pkey", "source=2 restored=0", "Name: custom; Type: SCHEMA"} {
		if !strings.Contains(got, want) {
			t.Fatalf("expected diagnostic to include %q, got %q", want, got)
		}
	}
}

func TestParityDifferencePreservesPublicMetadata(t *testing.T) {
	table := dumpSection("items; Type: TABLE; Schema: public; Owner: -", "CREATE TABLE public.items (id integer);")
	for _, tc := range []struct{ name, header, sql, changed string }{
		{"schema", "public; Type: SCHEMA; Schema: -; Owner: -", "CREATE SCHEMA public;", "CREATE SCHEMA other;"},
		{"comment", "SCHEMA public; Type: COMMENT; Schema: -; Owner: -", "COMMENT ON SCHEMA public IS 'original';", "COMMENT ON SCHEMA public IS 'changed';"},
		{"ACL", "SCHEMA public; Type: ACL; Schema: -; Owner: -", "GRANT USAGE ON SCHEMA public TO PUBLIC;", "GRANT USAGE ON SCHEMA public TO ipv6ftp_api;"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := plainDump(table, dumpSection(tc.header, tc.sql))
			if got := parityDifference(source, plainDump(table)); !strings.Contains(got, tc.header) {
				t.Fatalf("missing metadata was not reported: %s", got)
			}
			if got := parityDifference(source, plainDump(table, dumpSection(tc.header, tc.changed))); got == "" {
				t.Fatal("changed metadata passed parity")
			}
		})
	}
}

func TestParityDifferenceRetainsSemanticComparison(t *testing.T) {
	header := "t; Type: TABLE; Schema: public; Owner: -"
	a := plainDump(dumpSection(header, "CREATE TABLE t(id int);"))
	b := plainDump(dumpSection(header, "CREATE TABLE t(id text);"))
	if got := parityDifference(a, b); got == "" {
		t.Fatal("semantic section differences must remain detected")
	}
}

func TestGenerateBaselineRestoresOnceAndPublishesOnlyOnParity(t *testing.T) {
	const placeholder = "-- NOT GENERATED\n"
	dump := plainDump(dumpSection("schema_migrations; Type: TABLE; Schema: public; Owner: -", "CREATE TABLE public.schema_migrations (version bigint);"))
	restoreArgs := []string{"--no-psqlrc", "--no-password", "--set", "ON_ERROR_STOP=1", "--single-transaction", "--file=-", "--dbname", restoreName}
	for _, tc := range []struct {
		name, wantError string
		restored        []byte
		restoreError    error
	}{
		{name: "parity passes", restored: dump},
		{name: "parity fails", wantError: "restored schema parity mismatch", restored: plainDump()},
		{name: "restore fails", wantError: "schema restore failed", restoreError: errors.New("fake psql failure")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "baseline.sql")
			if err := os.WriteFile(path, []byte(placeholder), 0600); err != nil {
				t.Fatal(err)
			}
			old := runCommand
			t.Cleanup(func() { runCommand = old })
			calls := 0
			runCommand = func(cmd command) ([]byte, error) {
				calls++
				switch calls {
				case 1, 2:
					name, mark, service := fixtureName, fixtureMark, "source"
					if calls == 2 {
						name, mark, service = restoreName, restoreMark, "restore"
					}
					if cmd.name != "psql" || len(cmd.stdin) != 0 || !slices.Equal(cmd.env, []string{"PGSERVICE=" + service}) ||
						!strings.HasSuffix(strings.Join(cmd.args, " "), "--dbname "+name+" --command SELECT current_database() || E'\\t' || COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = current_database()") {
						t.Fatalf("unexpected identity verification: %+v", cmd)
					}
					return []byte(name + "\t" + mark + "\n"), nil
				case 3, 5:
					name, service, result := fixtureName, "source", dump
					if calls == 5 {
						name, service, result = restoreName, "restore", tc.restored
					}
					if cmd.name != "pg_dump" || !slices.Equal(cmd.args, schemaDumpArgs(name)) || !slices.Equal(cmd.env, []string{"PGSERVICE=" + service}) {
						t.Fatalf("unexpected schema dump: %+v", cmd)
					}
					return result, nil
				case 4:
					if cmd.name != "psql" || !slices.Equal(cmd.args, restoreArgs) || !bytes.Equal(cmd.stdin, dump) || !slices.Equal(cmd.env, []string{"PGSERVICE=restore"}) {
						t.Fatalf("expected only the transactional stdin restore, got %+v", cmd)
					}
					return nil, tc.restoreError
				default:
					t.Fatalf("unexpected extra command: %+v", cmd)
					return nil, nil
				}
			}
			err := generateBaseline("source", "restore", path, io.Discard)
			want, wantCalls := dump, 5
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("error = %v, want %q", err, tc.wantError)
				}
				want = []byte(placeholder)
			} else if err != nil {
				t.Fatal(err)
			}
			if tc.restoreError != nil {
				wantCalls = 4
			}
			if calls != wantCalls {
				t.Fatalf("command calls = %d, want %d", calls, wantCalls)
			}
			if got, err := os.ReadFile(path); err != nil || !bytes.Equal(got, want) {
				t.Fatalf("baseline = %q, want %q; read error: %v", got, want, err)
			}
		})
	}
}

func TestFirstDifferenceReportsSchemaChange(t *testing.T) {
	a := normalizeDump([]byte("CREATE TABLE t(id int);\n"))
	b := normalizeDump([]byte("CREATE TABLE other(id int);\n"))
	got := firstDifference(a, b)
	if got == "" || !bytes.Contains([]byte(got), []byte("CREATE TABLE t")) || !bytes.Contains([]byte(got), []byte("CREATE TABLE other")) {
		t.Fatalf("expected first differing schema lines, got %q", got)
	}
	if firstDifference(a, a) != "" {
		t.Fatal("identical normalized dumps differ")
	}
}
func TestAtomicReplace(t *testing.T) {
	p := filepath.Join(t.TempDir(), "base")
	if e := os.WriteFile(p, []byte("old"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := atomicReplace(p, []byte("new")); e != nil {
		t.Fatal(e)
	}
	b, e := os.ReadFile(p)
	if e != nil || string(b) != "new" {
		t.Fatalf("%q %v", b, e)
	}
}
func TestCommandFailureIncludesBoundedStderr(t *testing.T) {
	stderr := []byte("ERROR: schema restore detail")
	err := commandFailure(stderr, errors.New("exit status 1"))
	if !strings.Contains(err.Error(), "schema restore detail") {
		t.Fatalf("stderr detail did not propagate: %v", err)
	}
	long := commandFailure(bytes.Repeat([]byte("x"), maxCommandStderr+1), errors.New("exit status 1"))
	if len(long.Error()) > maxCommandStderr+100 || !strings.Contains(long.Error(), "[truncated]") {
		t.Fatalf("stderr was not bounded: length=%d error=%v", len(long.Error()), long)
	}
}

func TestOfflineCheck(t *testing.T) {
	p := filepath.Join(t.TempDir(), "base.sql")
	_ = os.WriteFile(p, []byte("-- NOT GENERATED"), 0600)
	old := runCommand
	runCommand = func(command) ([]byte, error) { t.Fatal("database command on offline check"); return nil, nil }
	defer func() { runCommand = old }()
	if e := run([]string{"--check", "--output", p}, io.Discard); e != nil {
		t.Fatal(e)
	}
}
func TestGenerateRequiresConfirmationBeforeDatabase(t *testing.T) {
	old := runCommand
	runCommand = func(command) ([]byte, error) { t.Fatal("database command before confirmation"); return nil, nil }
	defer func() { runCommand = old }()
	if e := run([]string{"--generate"}, io.Discard); e == nil {
		t.Fatal("expected refusal")
	}
}
