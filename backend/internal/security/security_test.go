package security

import "testing"

func TestIssueTokenPairSeparatesRoleAndType(t *testing.T) {
	secret := []byte("secret")
	access, refresh, err := IssueTokenPair(secret, "u1", "alice", "admin")
	if err != nil {
		t.Fatalf("IssueTokenPair() error = %v", err)
	}

	accessClaims, err := ParseToken(secret, access, "access")
	if err != nil {
		t.Fatalf("ParseToken(access) error = %v", err)
	}
	if accessClaims.Role != "admin" {
		t.Fatalf("access role = %q, want admin", accessClaims.Role)
	}
	if accessClaims.TokenType != "access" {
		t.Fatalf("access token type = %q", accessClaims.TokenType)
	}

	refreshClaims, err := ParseToken(secret, refresh, "refresh")
	if err != nil {
		t.Fatalf("ParseToken(refresh) error = %v", err)
	}
	if refreshClaims.Role != "admin" {
		t.Fatalf("refresh role = %q, want admin", refreshClaims.Role)
	}
	if refreshClaims.TokenType != "refresh" {
		t.Fatalf("refresh token type = %q", refreshClaims.TokenType)
	}
}

func TestParseTokenRejectsWrongType(t *testing.T) {
	secret := []byte("secret")
	access, _, err := IssueTokenPair(secret, "u1", "alice", "user")
	if err != nil {
		t.Fatalf("IssueTokenPair() error = %v", err)
	}
	if _, err := ParseToken(secret, access, "refresh"); err == nil {
		t.Fatal("ParseToken() expected error for wrong token type")
	}
}
