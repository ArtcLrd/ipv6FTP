package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"ipv6ftp/internal/repository"
)

type migrationFile struct {
	version  string
	name     string
	checksum string
	sql      string
}

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, args []string) error {
	_ = godotenv.Load()

	command := "up"
	if len(args) > 0 {
		command = strings.TrimSpace(args[0])
	}
	if command != "up" && command != "status" {
		return fmt.Errorf("unsupported command %q; use up or status", command)
	}

	connString := firstEnv("MIGRATOR_DATABASE_URL", "DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL")
	if connString == "" {
		return errors.New("MIGRATOR_DATABASE_URL or DATABASE_URL is required")
	}

	buildCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	pool, err := repository.NewPool(buildCtx, connString)
	if err != nil {
		return fmt.Errorf("postgres init failed: %w", err)
	}
	defer pool.Close()

	migrations, err := readMigrations("migrations")
	if err != nil {
		return err
	}
	if command == "status" {
		return printStatus(ctx, pool, migrations)
	}
	return applyMigrations(ctx, pool, migrations)
}

func readMigrations(dir string) ([]migrationFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	migrations := make([]migrationFile, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".sql") || name == "init_all.sql" {
			continue
		}
		version := strings.SplitN(name, "_", 2)[0]
		if version == "" {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(body)
		migrations = append(migrations, migrationFile{
			version:  version,
			name:     name,
			checksum: hex.EncodeToString(sum[:]),
			sql:      string(body),
		})
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })
	return migrations, nil
}

func applyMigrations(ctx context.Context, pool *pgxpool.Pool, migrations []migrationFile) error {
	runCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	tx, err := pool.Begin(runCtx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(runCtx) }()

	if _, err := tx.Exec(runCtx, `SELECT pg_advisory_xact_lock(hashtext('ipv6ftp.schema_migrations'))`); err != nil {
		return err
	}
	if err := ensureMigrationTable(runCtx, tx); err != nil {
		return err
	}

	for _, migration := range migrations {
		var appliedChecksum string
		err := tx.QueryRow(runCtx, `SELECT checksum FROM public.schema_migrations WHERE version = $1`, migration.version).Scan(&appliedChecksum)
		if err == nil {
			if appliedChecksum != migration.checksum {
				return fmt.Errorf("migration %s checksum mismatch", migration.name)
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(runCtx, migration.sql); err != nil {
			return fmt.Errorf("apply %s failed: %w", migration.name, err)
		}
		if _, err := tx.Exec(runCtx, `INSERT INTO public.schema_migrations(version, name, checksum) VALUES ($1, $2, $3)`, migration.version, migration.name, migration.checksum); err != nil {
			return err
		}
		log.Printf("applied %s", migration.name)
	}
	return tx.Commit(runCtx)
}

func ensureMigrationTable(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS public.schema_migrations (
			version TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			checksum TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`)
	return err
}

func printStatus(ctx context.Context, pool *pgxpool.Pool, migrations []migrationFile) error {
	runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	applied := map[string]string{}
	rows, err := pool.Query(runCtx, `SELECT version, checksum FROM public.schema_migrations`)
	if err != nil && !strings.Contains(err.Error(), "schema_migrations") {
		return err
	}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var version, checksum string
			if err := rows.Scan(&version, &checksum); err != nil {
				return err
			}
			applied[version] = checksum
		}
		if err := rows.Err(); err != nil {
			return err
		}
	}
	for _, migration := range migrations {
		state := "pending"
		if checksum, ok := applied[migration.version]; ok {
			state = "applied"
			if checksum != migration.checksum {
				state = "checksum-mismatch"
			}
		}
		fmt.Printf("%s %s %s\n", migration.version, state, migration.name)
	}
	return nil
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}
