package service

import (
	"context"
	crand "crypto/rand"
	"encoding/hex"
	"fmt"
	"math/rand/v2"
	"net/http"
	"time"

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

func checkPassword(hash, plain string) bool { return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil }

func hashRefreshToken(refresh string) string {
	if len(refresh) > 72 {
		refresh = refresh[:72]
	}
	hashed, _ := hashPassword(refresh, bcrypt.DefaultCost)
	return hashed
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
	hash, err := hashPassword(req.Password, s.cfg.BcryptCost)
	if err != nil {
		return models.User{}, "", "", err
	}
	user, err := s.users.Create(ctx, req.Username, hash, ipAddr)
	if err != nil {
		return models.User{}, "", "", err
	}
	access, refresh, err := security.IssueTokenPair([]byte(s.cfg.JWTSecret), user.ID, user.Username)
	if err != nil {
		return models.User{}, "", "", err
	}
	if s.sessions != nil {
		_ = s.sessions.Create(ctx, models.Session{ID: newID(), UserID: user.ID, TokenHash: hashRefreshToken(refresh), UserAgent: userAgent, IPAddr: ipAddr, ExpiresAt: time.Now().Add(7 * 24 * time.Hour)})
	}
	return user, access, refresh, nil
}

func (s *AuthService) Login(ctx context.Context, req models.LoginRequest, ipAddr, userAgent string) (models.User, string, string, error) {
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
	access, refresh, err := security.IssueTokenPair([]byte(s.cfg.JWTSecret), user.ID, user.Username)
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
	claims, err := security.ParseToken([]byte(s.cfg.JWTSecret), refreshToken, "refresh")
	if err != nil {
		return "", "", appErrors.ErrUnauthorized
	}
	access, refresh, err := security.IssueTokenPair([]byte(s.cfg.JWTSecret), claims.Sub, claims.Username)
	if err != nil {
		return "", "", err
	}
	if s.sessions != nil {
		_ = s.sessions.Create(ctx, models.Session{ID: newID(), UserID: claims.Sub, TokenHash: hashRefreshToken(refresh), UserAgent: userAgent, IPAddr: ipAddr, ExpiresAt: time.Now().Add(7 * 24 * time.Hour)})
	}
	return access, refresh, nil
}

func (s *AuthService) Me(ctx context.Context, userID string) (models.User, error) {
	return s.users.GetByID(ctx, userID)
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
			return &models.ResolvedAddress{Username: username}, nil
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

func jitter() { time.Sleep(time.Duration(50+rand.IntN(150)) * time.Millisecond) }