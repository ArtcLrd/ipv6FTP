package accountsec

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// These tests are a STATIC consistency check between repo.go and migrations
// 014/016. They do not touch a database and do not replace integration tests.

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

var (
	createTable = regexp.MustCompile(`(?is)CREATE TABLE\s+(iam\.\w+)\s*\((.*?)\n\);`)
	alterAdd    = regexp.MustCompile(`(?i)ALTER TABLE\s+(iam\.\w+)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)`)
	colDef      = regexp.MustCompile(`(?i)^\s*(\w+)\s+[a-z]`)
)

// schema returns table -> set of columns declared by migrations 014 and 016.
func schema(t *testing.T) map[string]map[string]bool {
	t.Helper()
	out := map[string]map[string]bool{}
	for _, f := range []string{"../../../migrations/014_native_ipv6_voice_reset.sql", "../../../migrations/016_account_security.sql", "../../../migrations/017_profile_lifecycle.sql", "../../../migrations/015_enrollment.sql", "../../../migrations/018_registered_foundations.sql", "../../../migrations/019_account_events.sql"} {
		sql := readFile(t, f)
		for _, m := range createTable.FindAllStringSubmatch(sql, -1) {
			cols := map[string]bool{}
			for _, line := range strings.Split(m[2], "\n") {
				if c := colDef.FindStringSubmatch(line); c != nil && !strings.HasPrefix(strings.TrimSpace(line), "CONSTRAINT") {
					cols[c[1]] = true
				}
			}
			out[m[1]] = cols
		}
		for _, m := range alterAdd.FindAllStringSubmatch(sql, -1) {
			if out[m[1]] == nil {
				t.Fatalf("%s altered before it is created", m[1])
			}
			out[m[1]][m[2]] = true
		}
	}
	return out
}

// used lists every table.column that repo.go reads or writes.
var used = map[string][]string{
	"iam.account_event_sequences": {"principal_id", "last_sequence"},
	"iam.principals":              {"id", "disabled_at"},
	"iam.accounts":                {"principal_id", "username", "password_hash", "credential_version", "recovery_ack_at", "username_changed_at", "deletion_requested_at", "deletion_deadline", "profile_revision", "device_generation", "activated_at"},
	"iam.devices":                 {"id", "principal_id", "revoked_at"},
	"iam.auth_sessions":           {"id", "device_id", "issued_at", "expires_at", "revoked_at"},
	"iam.refresh_tokens":          {"token_hash", "auth_session_id", "expires_at"},
	"iam.enrollment_challenges":   {"id", "principal_id", "nonce", "expires_at", "consumed_at", "credential_version", "device_generation", "server_key_id", "rotation_supported"},
	"iam.activation_operations":   {"principal_id", "operation_key", "fingerprint", "expires_at"},
	"iam.recovery_code_sets":      {"id", "principal_id", "retired_at"},
	"iam.recovery_codes":          {"set_id", "verifier", "consumed_at"},
	"iam.recovery_emails":         {"principal_id", "email_canonical", "address_version", "verified_at"},
	"iam.email_challenges":        {"id", "purpose", "principal_id", "email_canonical", "address_version", "verifier", "attempts", "created_at", "expires_at", "consumed_at", "superseded_at"},
	"iam.recovery_grants":         {"principal_id", "credential_version", "method", "token_hash", "expires_at", "used_at", "revoked_at"},
	"iam.email_outbox":            {"challenge_id", "recipient_canonical", "template", "payload_ciphertext", "key_version", "expires_at"},
	"iam.email_suppressions":      {"email_canonical"},
	"iam.username_reservations":   {"canonical", "principal_id", "kind"},
}

func TestRepositoryUsesOnlyColumnsThatExist(t *testing.T) {
	s := schema(t)
	for table, cols := range used {
		have, ok := s[table]
		if !ok {
			t.Errorf("table %s is not created by migrations 014/016", table)
			continue
		}
		for _, c := range cols {
			if !have[c] {
				t.Errorf("%s.%s is not defined by migrations 014/016", table, c)
			}
		}
	}
}

func TestEveryTableReferencedInRepoIsKnown(t *testing.T) {
	s := schema(t)
	src := readFile(t, "repo.go") + readFile(t, "lifecycle.go") + readFile(t, "enroll.go")
	ref := regexp.MustCompile(`\biam\.\w+`)
	found := map[string]bool{}
	for _, m := range ref.FindAllString(src, -1) {
		found[m] = true
	}
	if len(found) == 0 {
		t.Fatal("no iam tables found in repo.go; regex out of date")
	}
	for table := range found {
		if table == "iam.append_account_event" {
			if !strings.Contains(readFile(t, "../../../migrations/019_account_events.sql"), "CREATE FUNCTION "+table+"(") {
				t.Errorf("missing SQL function %s", table)
			}
			continue
		}
		if table == "iam.record_account_operation" {
			if !strings.Contains(readFile(t, "../../../migrations/018_registered_foundations.sql"), "CREATE FUNCTION "+table+"(") {
				t.Errorf("missing SQL function %s", table)
			}
			continue
		}
		if _, ok := s[table]; !ok {
			t.Errorf("repo.go references %s, which no migration creates", table)
		}
		if _, ok := used[table]; !ok {
			t.Errorf("repo.go references %s but schema_test.go does not list its columns; update 'used'", table)
		}
	}
}

func TestOnConflictTargetsAreUnique(t *testing.T) {
	sql := readFile(t, "../../../migrations/016_account_security.sql")
	// ON CONFLICT (principal_id) on recovery_emails needs a unique/PK on that column.
	if !regexp.MustCompile(`(?is)CREATE TABLE iam\.recovery_emails\s*\(\s*principal_id UUID PRIMARY KEY`).MatchString(sql) {
		t.Fatal("recovery_emails.principal_id must be the primary key for ON CONFLICT (principal_id)")
	}
	if !strings.Contains(sql, "uq_recovery_email_address") {
		t.Fatal("verified recovery email must be unique across accounts")
	}
}

func TestServiceLiteralsAreAllowedByCheckConstraints(t *testing.T) {
	sql := readFile(t, "../../../migrations/016_account_security.sql")
	for _, lit := range []string{"'verify_email'", "'recover_account'", "'saved_code'", "'email'"} {
		if !strings.Contains(sql, lit) {
			t.Errorf("migration 016 CHECK constraints do not allow %s", lit)
		}
	}
	svc := readFile(t, "../../service/account_security.go")
	for _, lit := range []string{`"verify_email"`, `"recover_account"`, `"saved_code"`, `"email"`} {
		if !strings.Contains(svc, lit) {
			t.Errorf("service no longer uses %s; update this test", lit)
		}
	}
}

func TestVerifierAndTokenSizesMatchColumnChecks(t *testing.T) {
	sql := readFile(t, "../../../migrations/016_account_security.sql")
	// repo.unhex insists on 32 bytes; every BYTEA column it writes is length-checked to 32.
	if got := strings.Count(sql, "octet_length(verifier) = 32") + strings.Count(sql, "octet_length(token_hash) = 32"); got < 3 {
		t.Fatalf("expected 32-byte checks on recovery_codes, email_challenges and recovery_grants, found %d", got)
	}
	if _, err := unhex(strings.Repeat("ab", 32)); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "zz", strings.Repeat("ab", 31), strings.Repeat("ab", 33)} {
		if _, err := unhex(bad); err == nil {
			t.Errorf("unhex accepted %q", bad)
		}
	}
}

func TestLifecycleMigrationSupportsRepositoryAssumptions(t *testing.T) {
	sql := readFile(t, "../../../migrations/017_profile_lifecycle.sql")
	for _, want := range []string{
		"canonical TEXT PRIMARY KEY",
		"kind IN ('former', 'retired')",
		"hashtextextended('username-lock:'",
		"BEFORE INSERT OR UPDATE OF username",
		"chk_accounts_deletion_pair",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("migration 017 lost %q", want)
		}
	}
	if !strings.Contains(readFile(t, "lifecycle.go"), "hashtextextended('username-lock:' || $1, 0)") {
		t.Error("lockUsernames no longer matches the trigger's advisory-lock key")
	}
}

func TestEnrollmentMigrationSupportsRepositoryAssumptions(t *testing.T) {
	sql := readFile(t, "../../../migrations/015_enrollment.sql")
	for _, want := range []string{
		"octet_length(nonce) = 32",                    // StoreChallenge writes 32 random bytes
		"uq_enroll_open_challenge",                    // one open challenge per account
		"WHERE consumed_at IS NULL",                   // StoreChallenge supersedes by consuming
		"device_generation BIGINT NOT NULL DEFAULT 0", // CommitEnrollment compares and increments
		"activated_at TIMESTAMPTZ",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("migration 015 lost %q", want)
		}
	}
}
