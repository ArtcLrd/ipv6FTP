import React, { useState } from 'react';
import { useAuth } from '../modules/auth/hooks';
import { useContacts } from '../modules/contacts/hooks';
import { webrtcManager } from '../modules/call/webrtc';
import { Contact } from '../modules/contacts/types';
import { useContactsUIStore } from '../state/contactsUIStore';
import { useIpv6Status } from '../hooks/useIpv6Status';
import { ContactsPageView } from './ContactsPageView';

export function ContactsPage({ navigation }: any) {
  const { user } = useAuth();
  const { data: contacts, isLoading: loadingContacts, refetch: refetchContacts, error } = useContacts();
  const [localSearch, setLocalSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { hasIpv6 } = useIpv6Status();
  const { activeFilter } = useContactsUIStore();

  const startCall = (contact: Contact) => {
    webrtcManager.startCall(contact);
  };

  const filteredContacts = (contacts || []).filter((c) => {
    const matchSearch = c.username.toLowerCase().includes(localSearch.toLowerCase());
    const matchFilter =
      activeFilter === 'all'
        ? true
        : activeFilter === 'online'
        ? c.status === 'online'
        : activeFilter === 'offline'
        ? c.status !== 'online'
        : activeFilter === 'ipv6'
        ? c.ip_addr?.includes(':')
        : activeFilter === 'ipv4'
        ? !!c.ip_addr && !c.ip_addr.includes(':')
        : true;
    return matchSearch && matchFilter;
  });

  const onlineCount = contacts?.filter((c) => c.status === 'online').length || 0;

  const handleContactPress = (contact: Contact) => {
    navigation.navigate('ContactDetails', { contact });
  };

  return (
    <ContactsPageView
      user={user}
      filteredContacts={filteredContacts}
      loadingContacts={loadingContacts}
      refetchContacts={refetchContacts}
      localSearch={localSearch}
      setLocalSearch={setLocalSearch}
      showFilters={showFilters}
      setShowFilters={setShowFilters}
      hasIpv6={hasIpv6}
      activeFilter={activeFilter}
      onlineCount={onlineCount}
      error={error}
      onContactPress={handleContactPress}
      onCallPress={startCall}
    />
  );
}

