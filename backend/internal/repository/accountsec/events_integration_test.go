//go:build integration

package accountsec

import (
	"context"
	"crypto/rand"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"ipv6ftp/internal/testutil"
)

// This creates test principals and must only run against a separately authorized disposable database.
func TestPostgresAccountEventIsolationAndRollback(t *testing.T) {
	dsn := testutil.RequirePostgresDSN(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	repo := New(pool)
	ids := make([]string, 0, 2)
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		for _, id := range ids {
			if _, err := pool.Exec(cleanup, `DELETE FROM iam.principals WHERE id=$1::uuid`, id); err != nil {
				t.Error(err)
			}
		}
	}()
	for i := 0; i < 2; i++ {
		var nonce [10]byte
		if _, err := rand.Read(nonce[:]); err != nil {
			t.Fatal(err)
		}
		id, err := repo.CreatePendingAccount(ctx, fmt.Sprintf("ev_%x", nonce), "test-only-unused-password-hash-aaaaaaaa")
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `SELECT iam.append_account_event($1::uuid,'username_changed','{}'::jsonb)`, ids[0]); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM iam.account_events WHERE principal_id=$1::uuid`, ids[0]).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rolled-back events: %d %v", count, err)
	}
	if _, err = pool.Exec(ctx, `SELECT iam.append_account_event($1::uuid,'username_changed','{}'::jsonb)`, ids[0]); err != nil {
		t.Fatal(err)
	}
	var first int64
	if err = pool.QueryRow(ctx, `SELECT sequence FROM iam.account_events WHERE principal_id=$1::uuid`, ids[0]).Scan(&first); err != nil || first != 1 {
		t.Fatalf("sequence after rollback: %d %v", first, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM iam.account_events WHERE principal_id=$1::uuid`, ids[1]).Scan(&count); err != nil || count != 0 {
		t.Fatalf("recipient isolation: %d %v", count, err)
	}
}
