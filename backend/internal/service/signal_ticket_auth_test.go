package service

import (
	"context"
	"errors"
	"testing"

	"ipv6ftp/internal/config"
	"ipv6ftp/internal/models"
	"ipv6ftp/internal/repository"
)

type signalAuthRepo struct {
	repository.CallRepo
	participant string
}

func (r *signalAuthRepo) AuthorizeSignal(context.Context, string, string) (models.CallSignalAuthorization, error) {
	return models.CallSignalAuthorization{ParticipantID: r.participant}, nil
}

func TestSignalTicketRechecksSessionAndParticipant(t *testing.T) {
	ctx := context.Background()
	repo := &signalAuthRepo{participant: "participant"}
	svc := NewCallService(config.Config{}, repo, repository.NewMemoryCacheRepo())
	for _, scenario := range []struct {
		name             string
		revoked, changed bool
	}{
		{name: "valid"}, {name: "revoked", revoked: true}, {name: "participant changed", changed: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			repo.participant = "participant"
			ticket, err := svc.NewSignalTicket(ctx, "call", "principal", "session", "device", 3)
			if err != nil {
				t.Fatal(err)
			}
			if scenario.changed {
				repo.participant = "other"
			}
			validate := func(_ context.Context, p, s, d string, version int) error {
				if p != "principal" || s != "session" || d != "device" || version != 3 {
					t.Fatal("incorrect session binding")
				}
				if scenario.revoked {
					return errors.New("revoked")
				}
				return nil
			}
			_, _, err = svc.ConsumeSignalTicket(ctx, "call", ticket.Ticket, validate)
			if (err != nil) != (scenario.revoked || scenario.changed) {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
