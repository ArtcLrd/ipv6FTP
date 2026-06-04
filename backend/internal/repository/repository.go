package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"ipv6ftp/internal/models"
)

type UserRepo interface {
	Create(ctx context.Context, username, passwordHash, ipAddr string) (models.User, error)
	GetByUsername(ctx context.Context, username string) (models.User, error)
	GetByID(ctx context.Context, id string) (models.User, error)
	UpdateStatusIP(ctx context.Context, id, ipAddr, status string) error
	Search(ctx context.Context, query, excludeID string) ([]models.UserPublic, error)
	ResetStatuses(ctx context.Context) error
	TouchOnline(ctx context.Context, when time.Time) error
}

type ContactRepo interface {
	List(ctx context.Context, ownerID string) ([]models.Contact, error)
	ListRelatedIDs(ctx context.Context, userID string) ([]string, error)
	Add(ctx context.Context, ownerID, contactID string) error
	Delete(ctx context.Context, ownerID, contactID string) (bool, error)
}

type SessionRepo interface {
	Create(ctx context.Context, session models.Session) error
	RevokeByUser(ctx context.Context, userID string) error
	Revoke(ctx context.Context, sessionID string) error
	IsRevoked(ctx context.Context, sessionID string) (bool, error)
}

type PhonebookRepo interface {
	Resolve(ctx context.Context, username string) (*models.ResolvedAddress, error)
	Heartbeat(ctx context.Context, userID string, req models.HeartbeatRequest, ipAddr string) error
	UpdatePublicKey(ctx context.Context, userID, publicKey string) error
}

type CacheRepo interface {
	Set(ctx context.Context, key string, value any, ttl time.Duration) error
	GetString(ctx context.Context, key string) (string, bool, error)
	Delete(ctx context.Context, key string) error
	Increment(ctx context.Context, key string, ttl time.Duration) (int64, error)
	SetBool(ctx context.Context, key string, value bool) error
	GetBool(ctx context.Context, key string) (bool, bool, error)
}

func NormalizeConnString(connStr string) string {
	if startIdx := strings.Index(connStr, ":["); startIdx != -1 {
		if endIdx := strings.Index(connStr[startIdx:], "]@"); endIdx != -1 {
			rawPass := connStr[startIdx+2 : startIdx+endIdx]
			encodedPass := url.QueryEscape(rawPass)
			connStr = connStr[:startIdx+1] + encodedPass + connStr[startIdx+endIdx+1:]
		}
	}
	return connStr
}

func NewPool(ctx context.Context, connStr string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(NormalizeConnString(connStr))
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 25
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

type MemoryCacheRepo struct {
	mu    sync.RWMutex
	items map[string]cacheItem
}

type cacheItem struct {
	value     string
	boolValue bool
	hasBool   bool
	expiresAt time.Time
}

func NewMemoryCacheRepo() *MemoryCacheRepo { return &MemoryCacheRepo{items: map[string]cacheItem{}} }

func (c *MemoryCacheRepo) Set(ctx context.Context, key string, value any, ttl time.Duration) error {
	encoded, _ := json.Marshal(value)
	c.mu.Lock()
	c.items[key] = cacheItem{value: string(encoded), expiresAt: time.Now().Add(ttl)}
	c.mu.Unlock()
	return nil
}

func (c *MemoryCacheRepo) GetString(ctx context.Context, key string) (string, bool, error) {
	c.mu.RLock()
	item, ok := c.items[key]
	c.mu.RUnlock()
	if !ok || (!item.expiresAt.IsZero() && time.Now().After(item.expiresAt)) {
		return "", false, nil
	}
	return item.value, true, nil
}

func (c *MemoryCacheRepo) Delete(ctx context.Context, key string) error {
	c.mu.Lock()
	delete(c.items, key)
	c.mu.Unlock()
	return nil
}

func (c *MemoryCacheRepo) Increment(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	item := c.items[key]
	if !item.expiresAt.IsZero() && time.Now().After(item.expiresAt) {
		item.value = "0"
	}
	count := int64(0)
	if item.value != "" {
		_, _ = fmt.Sscan(item.value, &count)
	}
	count++
	item.value = fmt.Sprintf("%d", count)
	item.expiresAt = time.Now().Add(ttl)
	c.items[key] = item
	return count, nil
}

func (c *MemoryCacheRepo) SetBool(ctx context.Context, key string, value bool) error {
	c.mu.Lock()
	c.items[key] = cacheItem{boolValue: value, hasBool: true}
	c.mu.Unlock()
	return nil
}

func (c *MemoryCacheRepo) GetBool(ctx context.Context, key string) (bool, bool, error) {
	c.mu.RLock()
	item, ok := c.items[key]
	c.mu.RUnlock()
	if !ok || !item.hasBool || (!item.expiresAt.IsZero() && time.Now().After(item.expiresAt)) {
		return false, false, nil
	}
	return item.boolValue, true, nil
}

type PgUserRepo struct{ Pool *pgxpool.Pool }
type PgContactRepo struct{ Pool *pgxpool.Pool }
type PgSessionRepo struct{ Pool *pgxpool.Pool }
type PgPhonebookRepo struct{ Pool *pgxpool.Pool }

func NewPgUserRepo(pool *pgxpool.Pool) *PgUserRepo           { return &PgUserRepo{Pool: pool} }
func NewPgContactRepo(pool *pgxpool.Pool) *PgContactRepo     { return &PgContactRepo{Pool: pool} }
func NewPgSessionRepo(pool *pgxpool.Pool) *PgSessionRepo     { return &PgSessionRepo{Pool: pool} }
func NewPgPhonebookRepo(pool *pgxpool.Pool) *PgPhonebookRepo { return &PgPhonebookRepo{Pool: pool} }

func (r *PgUserRepo) Create(ctx context.Context, username, passwordHash, ipAddr string) (models.User, error) {
	var user models.User
	err := r.Pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, ip_addr, status)
		VALUES ($1, $2, $3, 'online')
		RETURNING id::text, username, status, COALESCE(ip_addr, '')`, username, passwordHash, ipAddr).
		Scan(&user.ID, &user.Username, &user.Status, &user.IPAddr)
	if err != nil {
		return models.User{}, err
	}
	return user, nil
}

func (r *PgUserRepo) GetByUsername(ctx context.Context, username string) (models.User, error) {
	var user models.User
	err := r.Pool.QueryRow(ctx, `
		SELECT id::text, username, password_hash, role, status, COALESCE(ip_addr, '')
		FROM users WHERE username = $1`, username).
		Scan(&user.ID, &user.Username, &user.PasswordHash, &user.Role, &user.Status, &user.IPAddr)
	if err != nil {
		return models.User{}, err
	}
	return user, nil
}

func (r *PgUserRepo) GetByID(ctx context.Context, id string) (models.User, error) {
	var user models.User
	err := r.Pool.QueryRow(ctx, `
		SELECT id::text, username, role, status, COALESCE(ip_addr, '')
		FROM users WHERE id = $1`, id).
		Scan(&user.ID, &user.Username, &user.Role, &user.Status, &user.IPAddr)
	if err != nil {
		return models.User{}, err
	}
	return user, nil
}

func (r *PgUserRepo) UpdateStatusIP(ctx context.Context, id, ipAddr, status string) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET ip_addr = $1, status = $2, last_seen = NOW(), updated_at = NOW() WHERE id = $3`, ipAddr, status, id)
	return err
}

func (r *PgUserRepo) Search(ctx context.Context, query, excludeID string) ([]models.UserPublic, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT id::text, username, status, COALESCE(ip_addr, '')
		FROM users
		WHERE username ILIKE $1 AND id <> $2
		ORDER BY username
		LIMIT 10`, "%"+query+"%", excludeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]models.UserPublic, 0)
	for rows.Next() {
		var user models.UserPublic
		if err := rows.Scan(&user.ID, &user.Username, &user.Status, &user.IPAddr); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (r *PgUserRepo) ResetStatuses(ctx context.Context) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET status = 'offline'`)
	return err
}

func (r *PgUserRepo) TouchOnline(ctx context.Context, when time.Time) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET last_seen = $1 WHERE status = 'online'`, when)
	return err
}

func (r *PgContactRepo) List(ctx context.Context, ownerID string) ([]models.Contact, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT u.id::text, u.username, u.status, COALESCE(u.ip_addr, ''),
		       CASE WHEN c.owner_id = $1 THEN 'added_by_me' ELSE 'added_me' END AS direction
		FROM contacts c
		JOIN users u ON u.id = CASE WHEN c.owner_id = $1 THEN c.contact_id ELSE c.owner_id END
		WHERE c.owner_id = $1 OR c.contact_id = $1
		ORDER BY u.status DESC, u.username`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	contacts := make([]models.Contact, 0)
	for rows.Next() {
		var contact models.Contact
		if err := rows.Scan(&contact.ID, &contact.Username, &contact.Status, &contact.IPAddr, &contact.Direction); err != nil {
			return nil, err
		}
		contacts = append(contacts, contact)
	}
	return contacts, rows.Err()
}

func (r *PgContactRepo) ListRelatedIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT owner_id::text FROM contacts WHERE contact_id = $1
		UNION
		SELECT contact_id::text FROM contacts WHERE owner_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *PgContactRepo) Add(ctx context.Context, ownerID, contactID string) error {
	_, err := r.Pool.Exec(ctx, `INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2)`, ownerID, contactID)
	return err
}

func (r *PgContactRepo) Delete(ctx context.Context, ownerID, contactID string) (bool, error) {
	res, err := r.Pool.Exec(ctx, `DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2`, ownerID, contactID)
	if err != nil {
		return false, err
	}
	return res.RowsAffected() > 0, nil
}

func (r *PgSessionRepo) Create(ctx context.Context, session models.Session) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_addr, expires_at, is_revoked)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, session.ID, session.UserID, session.TokenHash, session.UserAgent, session.IPAddr, session.ExpiresAt, session.Revoked)
	return err
}

func (r *PgSessionRepo) RevokeByUser(ctx context.Context, userID string) error {
	_, err := r.Pool.Exec(ctx, `UPDATE sessions SET is_revoked = TRUE WHERE user_id = $1`, userID)
	return err
}

func (r *PgSessionRepo) Revoke(ctx context.Context, sessionID string) error {
	_, err := r.Pool.Exec(ctx, `UPDATE sessions SET is_revoked = TRUE WHERE id = $1`, sessionID)
	return err
}

func (r *PgSessionRepo) IsRevoked(ctx context.Context, sessionID string) (bool, error) {
	var revoked bool
	err := r.Pool.QueryRow(ctx, `SELECT is_revoked FROM sessions WHERE id = $1`, sessionID).Scan(&revoked)
	return revoked, err
}

func (r *PgPhonebookRepo) Resolve(ctx context.Context, username string) (*models.ResolvedAddress, error) {
	var entry models.ResolvedAddress
	if err := r.Pool.QueryRow(ctx, `
		SELECT u.id::text, u.username, p.ipv6_address::text, p.ipv4_address::text, p.is_ipv6_active, p.is_ipv4_fallback, p.last_seen, p.is_online, p.public_key
		FROM phonebook p
		JOIN users u ON u.id = p.user_id
		WHERE u.username = $1`, username).
		Scan(&entry.UserID, &entry.Username, &entry.IPv6Address, &entry.IPv4Address, &entry.IsIPv6Active, &entry.IsIPv4Fallback, &entry.LastSeen, &entry.IsOnline, &entry.PublicKey); err != nil {
		return nil, err
	}
	return &entry, nil
}

func (r *PgPhonebookRepo) Heartbeat(ctx context.Context, userID string, req models.HeartbeatRequest, ipAddr string) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO phonebook (user_id, ipv6_address, ipv4_address, is_ipv6_active, is_ipv4_fallback, last_seen, is_online, public_key)
		VALUES ($1, NULLIF($2, '')::inet, NULLIF($3, '')::inet, $4, $5, NOW(), $6, $7)
		ON CONFLICT (user_id) DO UPDATE SET
			ipv6_address = EXCLUDED.ipv6_address,
			ipv4_address = EXCLUDED.ipv4_address,
			is_ipv6_active = EXCLUDED.is_ipv6_active,
			is_ipv4_fallback = EXCLUDED.is_ipv4_fallback,
			last_seen = NOW(),
			is_online = EXCLUDED.is_online,
			public_key = EXCLUDED.public_key,
			updated_at = NOW()`, userID, req.IPv6, req.IPv4, true, false, req.Online, req.PublicKey)
	return err
}

func (r *PgPhonebookRepo) UpdatePublicKey(ctx context.Context, userID, publicKey string) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO phonebook (user_id, public_key, is_online)
		VALUES ($1, $2, FALSE)
		ON CONFLICT (user_id) DO UPDATE SET
			public_key = EXCLUDED.public_key,
			updated_at = NOW()`, userID, publicKey)
	return err
}

func duplicateErr(err error) bool {
	var pgErr *pgconn.PgError
	return err != nil && (errors.As(err, &pgErr) && pgErr.Code == "23505" || strings.Contains(err.Error(), "duplicate key"))
}

func IsDuplicateError(err error) bool {
	return duplicateErr(err)
}

func scanStringPtr(value any) *string {
	if value == nil {
		return nil
	}
	if s, ok := value.(*string); ok {
		return s
	}
	return nil
}
