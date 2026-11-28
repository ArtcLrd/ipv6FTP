export function InviteModal({ invite, onAccept, onDecline }) {
  const isCall = invite.type === "call";

  return (
    <div className="voice-panel__overlay invite-modal">
      <div className="voice-panel__incoming-dialog">
        <div className="voice-panel__ring-animation">
          {isCall ? "📞" : "⚡"}
        </div>
        <h3>{isCall ? "Incoming Call" : "Room Invite"}</h3>
        <p><strong>{invite.from_username}</strong> wants to {isCall ? "start a voice call" : "connect for file transfer"}.</p>
        
        <div className="voice-panel__incoming-actions">
          <button className="btn btn--primary" onClick={onAccept}>
            Accept
          </button>
          <button className="btn btn--secondary" onClick={onDecline}>
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
