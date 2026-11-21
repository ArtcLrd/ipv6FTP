package realtime

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"ipv6ftp/internal/repository"
)

const maxRendezvousPacketSize = 1200

type RendezvousServer struct {
	conn    *net.UDPConn
	cache   repository.CacheRepo
	signals *CallSignalHub
}

type rendezvousRegistration struct {
	Version  int    `json:"version"`
	TicketID string `json:"ticket_id"`
	Nonce    string `json:"nonce"`
	MAC      string `json:"mac"`
}

type rendezvousTicket struct {
	CallID      string `json:"call_id"`
	PrincipalID string `json:"principal_id"`
	DeviceID    string `json:"device_id"`
	Secret      string `json:"secret"`
}

type rendezvousResponse struct {
	Version  int    `json:"version"`
	Type     string `json:"type"`
	CallID   string `json:"call_id"`
	Endpoint string `json:"endpoint"`
	Nonce    string `json:"nonce"`
	MAC      string `json:"mac"`
}

func ListenRendezvous(addr string, cache repository.CacheRepo, signals *CallSignalHub) (*RendezvousServer, error) {
	udpAddr, err := net.ResolveUDPAddr("udp6", addr)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp6", udpAddr)
	if err != nil {
		return nil, err
	}
	return &RendezvousServer{conn: conn, cache: cache, signals: signals}, nil
}

func (s *RendezvousServer) Serve(ctx context.Context) error {
	buf := make([]byte, maxRendezvousPacketSize+1)
	for {
		_ = s.conn.SetReadDeadline(time.Now().Add(time.Second))
		n, remote, err := s.conn.ReadFromUDPAddrPort(buf)
		if err != nil {
			if errors.Is(err, net.ErrClosed) || ctx.Err() != nil {
				return nil
			}
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			continue
		}
		if n <= 0 || n > maxRendezvousPacketSize || !isPublicIPv6(remote.Addr()) {
			continue
		}
		packet := append([]byte(nil), buf[:n]...)
		go s.handle(ctx, packet, remote)
	}
}

func (s *RendezvousServer) Close() error { return s.conn.Close() }

func (s *RendezvousServer) handle(ctx context.Context, packet []byte, remote netip.AddrPort) {
	var req rendezvousRegistration
	if json.Unmarshal(packet, &req) != nil || req.Version != 1 || req.TicketID == "" || req.Nonce == "" || req.MAC == "" {
		return
	}
	key := "ipv6ftp:direct-ticket:" + req.TicketID
	raw, ok, err := s.cache.GetString(ctx, key)
	if err != nil || !ok {
		return
	}
	var ticket rendezvousTicket
	if json.Unmarshal([]byte(raw), &ticket) != nil {
		return
	}
	secret, err := base64.RawURLEncoding.DecodeString(ticket.Secret)
	if err != nil {
		return
	}
	requestText := strconv.Itoa(req.Version) + "|" + req.TicketID + "|" + req.Nonce
	if !validRendezvousMAC(secret, requestText, req.MAC) {
		return
	}
	_ = s.cache.Delete(ctx, key)
	endpoint := remote.String()
	responseText := "1|registered|" + ticket.CallID + "|" + endpoint + "|" + req.Nonce
	res := rendezvousResponse{Version: 1, Type: "registered", CallID: ticket.CallID, Endpoint: endpoint, Nonce: req.Nonce, MAC: makeRendezvousMAC(secret, responseText)}
	encoded, err := json.Marshal(res)
	if err == nil && len(encoded) <= maxRendezvousPacketSize {
		_, _ = s.conn.WriteToUDPAddrPort(encoded, remote)
	}
	_ = s.signals.PublishEndpoint(ctx, ticket.CallID, ticket.PrincipalID, map[string]string{"endpoint": endpoint, "device_id": ticket.DeviceID})
}

func isPublicIPv6(addr netip.Addr) bool {
	return addr.IsValid() && addr.Is6() && !addr.Is4In6() && addr.IsGlobalUnicast() && !addr.IsPrivate() && !addr.IsLoopback() && !addr.IsLinkLocalUnicast() && !addr.IsMulticast()
}

func validRendezvousMAC(secret []byte, text, encoded string) bool {
	provided, err := hex.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(text))
	return hmac.Equal(provided, mac.Sum(nil))
}

func makeRendezvousMAC(secret []byte, text string) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(text))
	return hex.EncodeToString(mac.Sum(nil))
}
