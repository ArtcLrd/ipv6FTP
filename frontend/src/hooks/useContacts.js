import { useState, useEffect, useCallback } from "react";
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
    try {
      const res = await apiGet("/api/contacts");
      if (res.ok) setContacts(await res.json());
    } catch (err) {
      console.error("Fetch contacts error", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

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
    // If a contact is added/removed by another device, we might want to refetch
    // or handle specific "contact-added" events.
  });

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await apiGet(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) {
        const results = await res.json();
        // Filter out existing contacts from search results
        const contactIds = new Set(contacts.map((c) => c.id));
        setSearchResults(results.filter((r) => !contactIds.has(r.id)));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, contacts]);

  const addContact = async (contactID) => {
    const res = await apiPost("/api/contacts", { contact_id: contactID });
    if (res.ok) {
      fetchContacts();
      setSearchQuery("");
      return { ok: true };
    }
    return { ok: false };
  };

  const removeContact = async (contactID) => {
    const res = await apiDelete(`/api/contacts/${contactID}`);
    if (res.ok) {
      setContacts((prev) => prev.filter((c) => c.id !== contactID));
      return { ok: true };
    }
    return { ok: false };
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
