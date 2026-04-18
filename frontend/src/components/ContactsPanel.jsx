import { useContacts } from "../hooks/useContacts";
import { apiPost } from "../lib/api";

export function ContactsPanel({ onJoinRoom, startCall }) {
  const { 
    contacts, 
    loading, 
    searchResults, 
    searchQuery, 
    setSearchQuery, 
    addContact, 
    removeContact 
  } = useContacts();

  const handleConnect = async (contact) => {
    try {
      const res = await apiPost("/api/rooms/create");
      if (res.ok) {
        const { room_id } = await res.json();
        // 1. Join locally as offerer
        onJoinRoom(room_id, "offerer");
        // 2. Invite peer via SSE
        await apiPost("/api/rooms/invite", {
          contact_id: contact.id,
          room_id,
          type: "room"
        });
      }
    } catch (err) {
      console.error("Connect error", err);
    }
  };

  const handleCall = async (contact) => {
    try {
      const res = await apiPost("/api/rooms/create");
      if (res.ok) {
        const { room_id } = await res.json();
        // 1. Join locally as offerer
        onJoinRoom(room_id, "offerer");
        // 2. Invite peer via SSE as a call
        await apiPost("/api/rooms/invite", {
          contact_id: contact.id,
          room_id,
          type: "call"
        });
        // 3. Start voice local transition
        // (AppPage will handle startCall once ice/signals are ready or we can trigger it)
        setTimeout(() => startCall(), 500);
      }
    } catch (err) {
      console.error("Call error", err);
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

function ContactRow({ contact, onConnect, onCall, onRemove, disabled }) {
  return (
    <div className={`contact-row ${disabled ? "contact-row--disabled" : ""}`}>
      <div className="contact-row__info">
        <span className={`presence-dot presence-dot--${contact.status}`} />
        <span className="contact-row__username">{contact.username}</span>
      </div>
      <div className="contact-row__actions">
        {!disabled && (
          <>
            <button className="btn btn--ghost btn--sm" title="Connect" onClick={onConnect}>⚡</button>
            <button className="btn btn--ghost btn--sm" title="Call" onClick={onCall}>📞</button>
          </>
        )}
        <button className="btn btn--danger-ghost btn--sm" title="Remove" onClick={onRemove}>✕</button>
      </div>
    </div>
  );
}
