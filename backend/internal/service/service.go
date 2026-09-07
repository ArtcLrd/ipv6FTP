package service

import (
	"context"
	crand "crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"

	"ipv6ftp/internal/config"
	appErrors "ipv6ftp/internal/errors"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/realtime"
	"ipv6ftp/internal/repository"
	"ipv6ftp/internal/security"
)

type AuthService struct {
	cfg      config.Config
	users    repository.UserRepo
	contacts repository.ContactRepo
	sessions repository.SessionRepo
	identity repository.IdentityRepo
	cache    repository.CacheRepo
	broker   *realtime.SSEBroker
}

type UserService struct {
	users    repository.UserRepo
	contacts repository.ContactRepo
	cache    repository.CacheRepo
	broker   *realtime.SSEBroker
}

type PhonebookService struct {
	repo  repository.PhonebookRepo
	cache repository.CacheRepo
}

func NewAuthService(cfg config.Config, users repository.UserRepo, contacts repository.ContactRepo, sessions repository.SessionRepo, cache repository.CacheRepo, broker *realtime.SSEBroker) *AuthService {
	return &AuthService{cfg: cfg, users: users, contacts: contacts, sessions: sessions, cache: cache, broker: broker}
}

func NewProductionAuthService(cfg config.Config, identity repository.IdentityRepo, users repository.UserRepo, contacts repository.ContactRepo, sessions repository.SessionRepo, cache repository.CacheRepo, broker *realtime.SSEBroker) *AuthService {
	return &AuthService{cfg: cfg, identity: identity, users: users, contacts: contacts, sessions: sessions, cache: cache, broker: broker}
}

func NewUserService(users repository.UserRepo, contacts repository.ContactRepo, cache repository.CacheRepo, broker *realtime.SSEBroker) *UserService {
	return &UserService{users: users, contacts: contacts, cache: cache, broker: broker}
}

func NewPhonebookService(repo repository.PhonebookRepo, cache repository.CacheRepo) *PhonebookService {
	return &PhonebookService{repo: repo, cache: cache}
}

func hashPassword(plain string, cost int) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(plain), cost)
	return string(bytes), err
}

func checkPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

func hashPasswordCredential(plain string) (string, error) {
	var salt [16]byte
	if _, err := crand.Read(salt[:]); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(plain), salt[:], 3, 64*1024, 1, 32)
	return fmt.Sprintf(
		"$argon2id$v=19$m=65536,t=3,p=1$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt[:]),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func checkPasswordCredential(hash, plain string) bool {
	if strings.HasPrefix(hash, "$argon2id$") {
		parts := strings.Split(hash, "$")
		if len(parts) != 6 {
			return false
		}
		params := strings.Split(parts[3], ",")
		if len(params) != 3 {
			return false
		}
		memory, err1 := strconv.ParseUint(strings.TrimPrefix(params[0], "m="), 10, 32)
		iterations, err2 := strconv.ParseUint(strings.TrimPrefix(params[1], "t="), 10, 32)
		parallelism, err3 := strconv.ParseUint(strings.TrimPrefix(params[2], "p="), 10, 8)
		salt, err4 := base64.RawStdEncoding.DecodeString(parts[4])
		expected, err5 := base64.RawStdEncoding.DecodeString(parts[5])
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil {
			return false
		}
		actual := argon2.IDKey([]byte(plain), salt, uint32(iterations), uint32(memory), uint8(parallelism), uint32(len(expected)))
		return subtle.ConstantTimeCompare(actual, expected) == 1
	}
	return checkPassword(hash, plain)
}

func hashRefreshToken(refresh string) string {
	if len(refresh) > 72 {
		refresh = refresh[:72]
	}
	hashed, _ := hashPassword(refresh, bcrypt.DefaultCost)
	return hashed
}

func hashOpaqueToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newOpaqueToken() (string, string, error) {
	var buf [32]byte
	if _, err := crand.Read(buf[:]); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(buf[:])
	hint := token
	if len(hint) > 8 {
		hint = hint[len(hint)-8:]
	}
	return token, hint, nil
}

func newID() string {
	var buf [16]byte
	if _, err := crand.Read(buf[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf[:])
}

func (s *AuthService) Register(ctx context.Context, req models.RegisterRequest, ipAddr, userAgent string) (models.User, string, string, error) {
	if len(req.Username) < 3 || len(req.Username) > 30 {
		return models.User{}, "", "", appErrors.New("Username must be 3-30 chars", http.StatusBadRequest)
	}
	if len(req.Password) < 8 {
		return models.User{}, "", "", appErrors.New("Password must be at least 8 chars", http.StatusBadRequest)
	}
	if s.identity != nil {
		hash, err := hashPasswordCredential(req.Password)
		if err != nil {
			return models.User{}, "", "", err
		}
		user, installationID, err := s.identity.Register(ctx, req, hash, ipAddr, userAgent)
		if err != nil {
			if repository.IsDuplicateError(err) || strings.Contains(err.Error(), "duplicate key") {
				return models.User{}, "", "", appErrors.New("Username or email is already taken", http.StatusConflict)
			}
			return models.User{}, "", "", err
		}
		return s.issueProductionTokenPair(ctx, user, installationID, ipAddr, userAgent)
	}
	hash, err := hashPassword(req.Password, s.cfg.BcryptCost)
	if err != nil {
		return models.User{}, "", "", err
	}
	user, err := s.users.Create(ctx, req.Username, hash, ipAddr)
	if err != nil {
		if repository.IsDuplicateError(err) {
			return models.User{}, "", "", appErrors.New("Username is already taken", http.StatusConflict)
		}
		return models.User{}, "", "", err
	}
	access, refresh, err := security.IssueTokenPair([]byte(s.cfg.JWTSecret), user.ID, user.Username, "user")
	if err != nil {
		return models.User{}, "", "", err
	}
	if s.sessions != nil {
		_ = s.sessions.Create(ctx, models.Session{ID: newID(), UserID: user.ID, TokenHash: hashRefreshToken(refresh), UserAgent: userAgent, IPAddr: ipAddr, ExpiresAt: time.Now().Add(7 * 24 * time.Hour)})
	}
	return user, access, refresh, nil
}

func (s *AuthService) Login(ctx context.Context, req models.LoginRequest, ipAddr, userAgent string) (models.User, string, string, error) {
	if s.identity != nil {
		identity, err := s.identity.FindPasswordIdentity(ctx, req.Username)
		if err != nil {
			return models.User{}, "", "", appErrors.New("Invalid credentials", http.StatusUnauthorized)
		}
		if !checkPasswordCredential(identity.PasswordHash, req.Password) {
			return models.User{}, "", "", appErrors.New("Invalid credentials", http.StatusUnauthorized)
		}
		if strings.TrimSpace(req.GuestID) != "" {
			if err := s.identity.MergeGuest(ctx, req.GuestID, identity.PrincipalID); err != nil {
				return models.User{}, "", "", err
			}
		}
		user, err := s.identity.GetProfile(ctx, identity.PrincipalID)
		if err != nil {
			return models.User{}, "", "", err
		}
		installationID, err := s.identity.AttachDevice(ctx, user.ID, req.Installation)
		if err != nil {
			return models.User{}, "", "", err
		}
		if installationID == "" {
			installationID = identity.DefaultInstallationID
		}
		return s.issueProductionTokenPair(ctx, user, installationID, ipAddr, userAgent)
	}
	user, err := s.users.GetByUsername(ctx, req.Username)
	if err != nil {
		return models.User{}, "", "", err
	}
	if !checkPassword(user.PasswordHash, req.Password) {
		return models.User{}, "", "", appErrors.New("Invalid credentials", http.StatusUnauthorized)
	}
	if err := s.users.UpdateStatusIP(ctx, user.ID, ipAddr, "online"); err != nil {
		return models.User{}, "", "", err
	}
	access, refresh, err := security.IssueTokenPair([]byte(s.cfg.JWTSecret), user.ID, user.Username, user.Role)
	if err != nil {
		return models.User{}, "", "", err
	}
	if s.sessions != nil {
		_ = s.sessions.Create(ctx, models.Session{ID: newID(), UserID: user.ID, TokenHash: hashRefreshToken(refresh), UserAgent: userAgent, IPAddr: ipAddr, ExpiresAt: time.Now().Add(7 * 24 * time.Hour)})
	}
	s.notifyContacts(ctx, user.ID, "contact-online")
	return models.User{ID: user.ID, Username: user.Username, IPAddr: ipAddr, Status: "online"}, access, refresh, nil
}

func (s *AuthService) Logout(ctx context.Context, claims *security.TokenClaims) error {
	if claims == nil {
		return nil
	}
	if s.identity != nil {
		if claims.SessionID != "" {
			return s.identity.RevokeSession(ctx, claims.Sub, claims.SessionID)
		}
		return s.identity.RevokeAllSessions(ctx, claims.Sub)
	}
	if err := s.users.UpdateStatusIP(ctx, claims.Sub, "", "offline"); err != nil {
		return err
	}
	s.notifyContacts(ctx, claims.Sub, "contact-offline")
	if s.sessions != nil {
		_ = s.sessions.RevokeByUser(ctx, claims.Sub)
	}
	return nil
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken, userAgent, ipAddr string) (string, string, error) {
	if s.identity != nil {
		nextRefresh, hint, err := newOpaqueToken()
		if err != nil {
			return "", "", err
		}
		user, sessionID, err := s.identity.RotateRefreshToken(ctx, hashOpaqueToken(refreshToken), hashOpaqueToken(nextRefresh), hint, userAgent, ipAddr, time.Now().Add(30*24*time.Hour))
		if err != nil {
			if err == pgx.ErrNoRows {
				return "", "", appErrors.ErrUnauthorized
			}
			return "", "", err
		}
		access, err := security.IssueSessionAccessToken([]byte(s.cfg.JWTSecret), user.ID, sessionID, user.DeviceID, user.Username, user.Role, user.AccountType, user.PlanCode, user.AuthVersion)
		if err != nil {
			return "", "", err
		}
		return access, nextRefresh, nil
	}
	claims, err := security.ParseToken([]byte(s.cfg.JWTSecret), refreshToken, "refresh")
	if err != nil {
		return "", "", appErrors.ErrUnauthorized
	}
	access, refresh, err := security.IssueTokenPair([]byte(s.cfg.JWTSecret), claims.Sub, claims.Username, claims.Role)
	if err != nil {
		return "", "", err
	}
	if s.sessions != nil {
		_ = s.sessions.Create(ctx, models.Session{ID: newID(), UserID: claims.Sub, TokenHash: hashRefreshToken(refresh), UserAgent: userAgent, IPAddr: ipAddr, ExpiresAt: time.Now().Add(7 * 24 * time.Hour)})
	}
	return access, refresh, nil
}

func (s *AuthService) Me(ctx context.Context, userID string) (models.User, error) {
	if s.identity != nil {
		return s.identity.GetProfile(ctx, userID)
	}
	return s.users.GetByID(ctx, userID)
}

func (s *AuthService) ListPendingPrompts(ctx context.Context, userID string) ([]models.ConversionPrompt, error) {
	if s.identity == nil {
		return []models.ConversionPrompt{}, nil
	}
	return s.identity.ListPendingPrompts(ctx, userID)
}

func (s *AuthService) RecordPromptAction(ctx context.Context, userID string, req models.PromptActionRequest) error {
	if strings.TrimSpace(req.Code) == "" {
		return appErrors.New("prompt code is required", http.StatusBadRequest)
	}
	if s.identity == nil {
		return appErrors.New("Prompt actions are not enabled on this backend", http.StatusNotImplemented)
	}
	return s.identity.RecordPromptAction(ctx, userID, req)
}

func (s *AuthService) BootstrapGuest(ctx context.Context, req models.GuestBootstrapRequest, ipAddr, userAgent string) (models.User, string, string, error) {
	if s.identity == nil {
		return models.User{}, "", "", appErrors.New("Guest mode is not enabled on this backend", http.StatusNotImplemented)
	}
	user, installationID, err := s.identity.BootstrapGuest(ctx, req, ipAddr, userAgent)
	if err != nil {
		return models.User{}, "", "", err
	}
	return s.issueProductionTokenPair(ctx, user, installationID, ipAddr, userAgent)
}

func (s *AuthService) issueProductionTokenPair(ctx context.Context, user models.User, installationID, ipAddr, userAgent string) (models.User, string, string, error) {
	refresh, hint, err := newOpaqueToken()
	if err != nil {
		return models.User{}, "", "", err
	}
	sessionID, err := s.identity.CreateAuthSession(ctx, user.ID, installationID, hashOpaqueToken(refresh), hint, userAgent, ipAddr, time.Now().Add(30*24*time.Hour))
	if err != nil {
		return models.User{}, "", "", err
	}
	user.DeviceID = installationID
	access, err := security.IssueSessionAccessToken([]byte(s.cfg.JWTSecret), user.ID, sessionID, installationID, user.Username, user.Role, user.AccountType, user.PlanCode, user.AuthVersion)
	if err != nil {
		return models.User{}, "", "", err
	}
	return user, access, refresh, nil
}

// UsernameExists returns true when a user with the given username is found.
// A "not found" result is treated as exists=false (not an error).
func (s *AuthService) UsernameExists(ctx context.Context, username string) (bool, error) {
	if s.identity != nil {
		_, err := s.identity.FindPasswordIdentity(ctx, username)
		if err != nil {
			return false, nil
		}
		return true, nil
	}
	_, err := s.users.GetByUsername(ctx, username)
	if err != nil {
		// Assume not found — the repo returns an error for missing rows
		return false, nil
	}
	return true, nil
}

func (s *AuthService) notifyContacts(ctx context.Context, userID, eventType string) {
	if s.contacts == nil || s.broker == nil {
		return
	}
	ids, err := s.contacts.ListRelatedIDs(ctx, userID)
	if err != nil {
		return
	}
	for _, id := range ids {
		s.broker.Publish(id, realtime.Event{Type: eventType, Payload: map[string]string{"user_id": userID}})
	}
}

func (s *UserService) UpdateIP(ctx context.Context, userID, ipAddr string) error {
	if err := s.users.UpdateStatusIP(ctx, userID, ipAddr, "online"); err != nil {
		return err
	}
	if s.cache != nil {
		_ = s.cache.Set(ctx, "ipv6ftp:presence:"+userID, ipAddr, 10*time.Minute)
	}
	return nil
}

func (s *UserService) Search(ctx context.Context, userID, query string) ([]models.UserPublic, error) {
	if len(query) < 2 {
		return []models.UserPublic{}, nil
	}
	return s.users.Search(ctx, query, userID)
}

func (s *UserService) ListContacts(ctx context.Context, userID string) ([]models.Contact, error) {
	return s.contacts.List(ctx, userID)
}

func (s *UserService) AddContact(ctx context.Context, ownerID, contactID string) error {
	if contactID == ownerID {
		return appErrors.New("Cannot add yourself", http.StatusBadRequest)
	}
	return s.contacts.Add(ctx, ownerID, contactID)
}

func (s *UserService) DeleteContact(ctx context.Context, ownerID, contactID string) error {
	deleted, err := s.contacts.Delete(ctx, ownerID, contactID)
	if err != nil {
		return err
	}
	if !deleted {
		return appErrors.New("Not found", http.StatusNotFound)
	}
	return nil
}

func (s *UserService) PublishContactsUpdated(userID string) {
	if s.broker != nil {
		s.broker.Publish(userID, realtime.Event{Type: "contacts-updated", Payload: map[string]string{"user_id": userID}})
	}
}

func (s *PhonebookService) Lookup(ctx context.Context, username string) (*models.ResolvedAddress, error) {
	if username == "" {
		return nil, nil
	}
	if s.cache != nil {
		if cached, ok, _ := s.cache.GetString(ctx, "ipv6ftp:phonebook:"+username); ok && cached != "" {
			var entry models.ResolvedAddress
			if err := json.Unmarshal([]byte(cached), &entry); err == nil {
				return &entry, nil
			}
		}
	}
	entry, err := s.repo.Resolve(ctx, username)
	jitter()
	if err != nil {
		return nil, err
	}
	if s.cache != nil {
		_ = s.cache.Set(ctx, "ipv6ftp:phonebook:"+username, entry, 30*time.Second)
	}
	return entry, nil
}

func (s *PhonebookService) Heartbeat(ctx context.Context, userID string, req models.HeartbeatRequest, ipAddr string) error {
	return s.repo.Heartbeat(ctx, userID, req, ipAddr)
}

func (s *PhonebookService) UpdatePublicKey(ctx context.Context, userID, publicKey string) error {
	if publicKey == "" {
		return appErrors.New("public_key is required", http.StatusBadRequest)
	}
	if s.cache != nil {
		_ = s.cache.Set(ctx, "ipv6ftp:pubkey:"+userID, publicKey, time.Hour)
	}
	return s.repo.UpdatePublicKey(ctx, userID, publicKey)
}

func jitter() { time.Sleep(time.Duration(50+rand.IntN(150)) * time.Millisecond) }
