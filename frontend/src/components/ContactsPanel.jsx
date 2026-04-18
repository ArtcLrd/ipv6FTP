import { useState } from "react";
import { useContacts } from "../hooks/useContacts";
import { apiPost } from "../lib/api";

export function ContactsPanel({ onJoinRoom, isConnected, currentRoomID, onDisconnect }) {
  const { 
    contacts, 
    loading, 
    searchResults, 
    searchQuery, 
    setSearchQuery, 
    addContact, 
    removeContact 
  } = useContacts();

  // Track which contact we're currently trying to connect/call to
  const [pendingContactId, setPendingContactId] = useState(null);

  const handleConnect = async (contact) => {
    if (pendingContactId) return; // already in progress
    setPendingContactId(contact.id);
    try {
      const res = await apiPost("/api/rooms/create");
      if (res.ok) {
        const { room_id } = await res.json();
        // onJoinRoom handles disconnect internally — no need to call onDisconnect here
        onJoinRoom(room_id, "offerer");
        // Invite peer via SSE
        await apiPost("/api/rooms/invite", {
          contact_id: contact.id,
          room_id,
          type: "room"
        });
      }
    } catch (err) {
      console.error("Connect error", err);
    } finally {
      // Keep pendingContactId until connection is fully established or fails.
      // We clear it after a delay since connection state is managed by AppPage.
      setTimeout(() => setPendingContactId(null), 500);
    }
  };

  const handleCall = async (contact) => {
    if (pendingContactId) return;
    setPendingContactId(contact.id);
    try {
      const res = await apiPost("/api/rooms/create");
      if (res.ok) {
        const { room_id } = await res.json();
        // onJoinRoom handles disconnect internally
        onJoinRoom(room_id, "offerer");
        // Invite peer via SSE as a call
        await apiPost("/api/rooms/invite", {
          contact_id: contact.id,
          room_id,
          type: "call"
        });
        // NOTE: startCall() is now triggered in AppPage once ICE is actually connected.
        // Do NOT call startCall() here directly — it won't work before ICE is up.
      }
    } catch (err) {
      console.error("Call error", err);
    } finally {
      setTimeout(() => setPendingContactId(null), 500);
    }
  };

  const onlineContacts = contacts.filter(c => c.status === "online");
  const offlineContacts = contacts.filter(c => c.status !== "online");

  return (
    <div className="contacts-panel">
      <h2 className="contacts-panel__title">Contacts</h2>
      
      <div className="contacts-search">
        <input
          type="text"
          className="input contacts-search__input"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchResults.length > 0 && (
          <div className="contacts-search__results">
            {searchResults.map(result => (
              <div key={result.id} className="search-result">
                <span>{result.username}</span>
                <button className="btn btn--primary-sm" onClick={() => addContact(result.id)}>+ Add</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="contacts-list">
        {loading && <div className="contacts-list__loading">Loading...</div>}
        
        {!loading && contacts.length === 0 && (
          <div className="contacts-list__empty">No contacts yet. Search above to add friends.</div>
        )}

        {onlineContacts.length > 0 && (
          <div className="contacts-group">
            <h3 className="contacts-group__title">Online ({onlineContacts.length})</h3>
            {onlineContacts.map(contact => (
              <ContactRow 
                key={contact.id} 
                contact={contact} 
                onConnect={() => handleConnect(contact)}
                onCall={() => handleCall(contact)}
                onRemove={() => removeContact(contact.id)}
                isPending={pendingContactId === contact.id}
              />
            ))}
          </div>
        )}

        {offlineContacts.length > 0 && (
          <div className="contacts-group">
            <h3 className="contacts-group__title">Offline ({offlineContacts.length})</h3>
            {offlineContacts.map(contact => (
              <ContactRow 
                key={contact.id} 
                contact={contact} 
                onRemove={() => removeContact(contact.id)}
                disabled
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactRow({ contact, onConnect, onCall, onRemove, disabled, isPending }) {
  return (
    <div className={`contact-row ${disabled ? "contact-row--disabled" : ""}`}>
      <div className="contact-row__info">
        <span className={`presence-dot presence-dot--${contact.status}`} />
        <span className="contact-row__username">{contact.username}</span>
      </div>
      <div className="contact-row__actions">
        {!disabled && (
          <>
            <button 
              className="btn btn--ghost btn--sm" 
              title={isPending ? "Connecting..." : "Connect"} 
              onClick={onConnect}
              disabled={isPending}
            >
              {isPending ? "⏳" : "⚡"}
            </button>
            <button 
              className="btn btn--ghost btn--sm" 
              title={isPending ? "Connecting..." : "Call"} 
              onClick={onCall}
              disabled={isPending}
            >
              {isPending ? "⏳" : "📞"}
            </button>
          </>
        )}
        <button className="btn btn--danger-ghost btn--sm" title="Remove" onClick={onRemove}>✕</button>
      </div>
    </div>
  );
}
