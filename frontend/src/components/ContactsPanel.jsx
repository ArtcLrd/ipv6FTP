import { useState, useRef, useEffect, useCallback } from "react";
import { useContacts } from "../hooks/useContacts";
import { apiPost } from "../lib/api";

export function ContactsPanel({ onJoinRoom, isConnected, currentRoomID, onDisconnect, pendingCallStartRef }) {
  const { 
    contacts, 
    loading, 
    searchResults, 
    searchQuery, 
    setSearchQuery, 
    addContact, 
    removeContact 
  } = useContacts();

  // BUG 4 FIX: track per-contact pending state, not a single global one
  const [pendingContacts, setPendingContacts] = useState(new Set());
  // Track which dropdown is open
  const [activeDropdown, setActiveDropdown] = useState(null);

  const setPending = (id, val) => {
    setPendingContacts(prev => {
      const next = new Set(prev);
      val ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const handleConnect = async (contact) => {
    if (pendingContacts.has(contact.id)) return;
    setPending(contact.id, true);
    setActiveDropdown(null);
    try {
      const res = await apiPost("/api/rooms/create");
      if (res.ok) {
        const { room_id } = await res.json();
        onJoinRoom(room_id, "offerer");
        await apiPost("/api/rooms/invite", {
          contact_id: contact.id,
          room_id,
          type: "room"
        });
      }
    } catch (err) {
      console.error("Connect error", err);
    } finally {
      setTimeout(() => setPending(contact.id, false), 500);
    }
  };

  const handleCall = async (contact) => {
    if (pendingContacts.has(contact.id)) return;
    setPending(contact.id, true);
    setActiveDropdown(null);
    try {
      const res = await apiPost("/api/rooms/create");
      if (res.ok) {
        const { room_id } = await res.json();
        // Join the room first — handleJoinRoom calls disconnect() internally which
        // resets pendingCallStartRef. We set it AFTER so it survives the reset.
        onJoinRoom(room_id, "offerer");
        // Signal AppPage to call startCall() once ICE connects
        if (pendingCallStartRef) pendingCallStartRef.current = true;
        await apiPost("/api/rooms/invite", {
          contact_id: contact.id,
          room_id,
          type: "call"
        });
      }
    } catch (err) {
      console.error("Call error", err);
    } finally {
      setTimeout(() => setPending(contact.id, false), 500);
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
                // BUG 3 FIX: close dropdown on remove
                onRemove={() => { setActiveDropdown(null); removeContact(contact.id); }}
                isPending={pendingContacts.has(contact.id)}
                isOpen={activeDropdown === contact.id}
                setIsOpen={(val) => setActiveDropdown(val ? contact.id : null)}
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
                // BUG 3 FIX: close dropdown on remove
                onRemove={() => { setActiveDropdown(null); removeContact(contact.id); }}
                isOpen={activeDropdown === contact.id}
                setIsOpen={(val) => setActiveDropdown(val ? contact.id : null)}
                disabled
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactRow({ contact, onConnect, onCall, onRemove, disabled, isPending, isOpen, setIsOpen }) {
  const [showConfirm, setShowConfirm] = useState(false);
  // BUG 2 FIX: ref on the contact-actions container only, not the full row
  const actionsRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (actionsRef.current && !actionsRef.current.contains(event.target)) {
        setIsOpen(false);
        setShowConfirm(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, setIsOpen]);

  // Reset confirm state when dropdown closes
  useEffect(() => {
    if (!isOpen) setShowConfirm(false);
  }, [isOpen]);

  return (
    <div className={`contact-row ${disabled ? "contact-row--disabled" : ""}`}>
      <div className="contact-row__info">
        <span className={`presence-dot presence-dot--${contact.status}`} />
        <span className="contact-row__username">{contact.username}</span>
      </div>
      
      {/* BUG 2 FIX: ref on this container, not the full row */}
      <div className="contact-actions" ref={actionsRef}>
        <button 
          className="contact-actions__trigger" 
          onClick={() => setIsOpen(!isOpen)}
          disabled={isPending}
        >
          {isPending ? "⏳" : "⋮"}
        </button>

        {isOpen && (
          <div className="contact-dropdown">
            {!showConfirm ? (
              <>
                <button 
                  className="contact-dropdown__item contact-dropdown__item--connect" 
                  onClick={onConnect}
                  disabled={disabled || isPending}
                >
                  <span className="contact-dropdown__icon">⚡</span>
                  Connect Room
                </button>
                <button 
                  className="contact-dropdown__item contact-dropdown__item--call" 
                  onClick={onCall}
                  disabled={disabled || isPending}
                >
                  <span className="contact-dropdown__icon">📞</span>
                  Voice Call
                </button>
                <div style={{ height: "1px", background: "var(--border)", margin: "4px 0" }} />
                <button 
                  className="contact-dropdown__item contact-dropdown__item--danger" 
                  onClick={() => setShowConfirm(true)}
                >
                  <span className="contact-dropdown__icon">✕</span>
                  Remove Contact
                </button>
              </>
            ) : (
              <div className="contact-dropdown__confirm">
                <div className="contact-dropdown__confirm-text">Remove @{contact.username}?</div>
                <div className="contact-dropdown__confirm-actions">
                  <button 
                    className="btn btn--danger-ghost contact-dropdown__confirm-btn" 
                    onClick={onRemove}
                  >
                    Yes
                  </button>
                  <button 
                    className="btn btn--secondary contact-dropdown__confirm-btn" 
                    onClick={() => setShowConfirm(false)}
                  >
                    No
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
