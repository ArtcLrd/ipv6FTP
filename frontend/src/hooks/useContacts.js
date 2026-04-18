import { useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost, apiDelete } from "../lib/api";
import { useSSE } from "./useSSE";
import { useAuth } from "../contexts/AuthContext";

export function useContacts() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchContacts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiGet("/api/contacts");
      if (res.ok) {
        const data = await res.json();
        setContacts(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Fetch contacts error", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // BUG 5 FIX: stable ref so SSE callback never closes over a stale fetchContacts
  const fetchContactsRef = useRef(fetchContacts);
  fetchContactsRef.current = fetchContacts;

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Handle real-time presence/contact updates
  useSSE((event) => {
    if (event.type === "contact-online" || event.type === "contact-offline") {
      setContacts((prev) =>
        prev.map((c) =>
          c.id === event.payload.user_id
            ? { ...c, status: event.type === "contact-online" ? "online" : "offline" }
            : c
        )
      );
    }
    // BUG 5 FIX: use ref so we always get the latest fetchContacts
    if (event.type === "contacts-updated") {
      fetchContactsRef.current();
    }
  });

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await apiGet(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const results = await res.json();
          // Filter out already-added contacts from search results
          const contactIds = new Set(contacts.map((c) => c.id));
          setSearchResults((Array.isArray(results) ? results : []).filter((r) => !contactIds.has(r.id)));
        }
      } catch (err) {
        console.error("Search error", err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, contacts]);

  const addContact = async (contactID) => {
    try {
      const res = await apiPost("/api/contacts", { contact_id: contactID });
      if (res.ok) {
        // Always clear search immediately for responsiveness
        setSearchQuery("");
        setSearchResults([]);
        // Refetch contacts from server so the new entry has full data (id, username, status)
        await fetchContacts();
        return { ok: true };
      }
      return { ok: false };
    } catch (err) {
      console.error("Add contact error", err);
      return { ok: false };
    }
  };

  const removeContact = async (contactID) => {
    // Optimistic local removal for instant UI feedback
    setContacts((prev) => prev.filter((c) => c.id !== contactID));
    try {
      const res = await apiDelete(`/api/contacts/${contactID}`);
      if (!res.ok) {
        // Revert if the server rejected it
        await fetchContacts();
        return { ok: false };
      }
      return { ok: true };
    } catch (err) {
      console.error("Remove contact error", err);
      await fetchContacts();
      return { ok: false };
    }
  };

  return {
    contacts,
    loading,
    searchResults,
    searchQuery,
    setSearchQuery,
    addContact,
    removeContact,
    refreshContacts: fetchContacts,
  };
}
