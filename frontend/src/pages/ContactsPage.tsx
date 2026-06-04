import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  Animated,
} from 'react-native';
import { useAuth } from '../modules/auth/hooks';
import { useContacts } from '../modules/contacts/hooks';
import { webrtcManager } from '../modules/call/webrtc';
import { Contact } from '../modules/contacts/types';
import { Theme } from '../theme';
import { Avatar } from '../components/Avatar';
import { GlassCard } from '../components/GlassCard';
import { Ionicons } from '@expo/vector-icons';

function PulsingStatus({ isOnline }: { isOnline: boolean }) {
  const pulseAnim = React.useRef(new Animated.Value(0.4)).current;

  React.useEffect(() => {
    if (!isOnline) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [isOnline]);

  if (!isOnline) {
    return (
      <View
        style={[
          styles.statusIndicator,
          { backgroundColor: Theme.colors.textSecondary },
        ]}
      />
    );
  }

  return (
    <View style={styles.pulseContainer}>
      <Animated.View
        style={[
          styles.statusPulse,
          {
            backgroundColor: Theme.colors.success,
            transform: [
              {
                scale: pulseAnim.interpolate({
                  inputRange: [0.4, 1],
                  outputRange: [1, 2.2],
                }),
              },
            ],
            opacity: pulseAnim.interpolate({
              inputRange: [0.4, 1],
              outputRange: [0.8, 0],
            }),
          },
        ]}
      />
      <View
        style={[
          styles.statusIndicator,
          { backgroundColor: Theme.colors.success },
        ]}
      />
    </View>
  );
}

export function ContactsPage({ navigation }: any) {
  const { user } = useAuth();
  const { data: contacts, isLoading: loadingContacts, refetch: refetchContacts } = useContacts();
  const [localSearch, setLocalSearch] = useState('');

  const startCall = (contact: Contact) => {
    webrtcManager.startCall(contact);
  };

  const filteredContacts = contacts?.filter((c) =>
    c.username.toLowerCase().includes(localSearch.toLowerCase())
  );

  const onlineCount = contacts?.filter((c) => c.status === 'online').length || 0;

  const renderContact = ({ item }: { item: Contact }) => {
    const isOnline = item.status === 'online';

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => navigation.navigate('ContactDetails', { contact: item })}
      >
        <GlassCard style={styles.contactCard}>
          <View style={styles.contactLeft}>
            <Avatar username={item.username} size={44} />
            <View style={styles.statusIndicatorContainer}>
              <PulsingStatus isOnline={isOnline} />
            </View>
            <View style={styles.contactDetails}>
              <Text style={styles.contactName}>{item.username}</Text>
              <Text style={styles.contactStatus}>
                {isOnline ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>
          <View style={styles.contactRight}>
            <TouchableOpacity
              style={styles.callIconButton}
              onPress={() => startCall(item)}
            >
              <Ionicons name="call" size={20} color={Theme.colors.accent} />
            </TouchableOpacity>
            <Ionicons name="chevron-forward" size={20} color={Theme.colors.textSecondary} style={styles.chevron} />
          </View>
        </GlassCard>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeText}>Hello,</Text>
          <Text style={styles.usernameText}>{user?.username || 'User'}</Text>
        </View>
        <View style={styles.peerCountCard}>
          <Text style={styles.peerCountNum}>
            {onlineCount}/{contacts?.length || 0}
          </Text>
          <Text style={styles.peerCountLabel}>Peers Online</Text>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={Theme.colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Filter contacts..."
          placeholderTextColor={Theme.colors.textSecondary}
          value={localSearch}
          onChangeText={setLocalSearch}
        />
        {localSearch.length > 0 && (
          <TouchableOpacity onPress={() => setLocalSearch('')}>
            <Ionicons name="close-circle" size={18} color={Theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filteredContacts}
        keyExtractor={(item) => item.id}
        renderItem={renderContact}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={loadingContacts}
            onRefresh={refetchContacts}
            tintColor={Theme.colors.accent}
            colors={[Theme.colors.accent]}
          />
        }
        ListEmptyComponent={
          !loadingContacts ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color={Theme.colors.textSecondary} />
              <Text style={styles.emptyText}>
                {localSearch ? 'No matching contacts.' : 'No contacts yet. Go to the Add tab to find peers!'}
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
  },
  welcomeText: {
    fontSize: 16,
    color: Theme.colors.textSecondary,
  },
  usernameText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  peerCountCard: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderRadius: Theme.roundness.md,
    alignItems: 'center',
  },
  peerCountNum: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Theme.colors.accent,
  },
  peerCountLabel: {
    fontSize: 10,
    color: Theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(23, 28, 32, 0.5)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.roundness.md,
    marginHorizontal: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.sm,
    height: 40,
    marginBottom: Theme.spacing.md,
  },
  searchIcon: {
    marginRight: Theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    color: Theme.colors.textPrimary,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  contactCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  contactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicatorContainer: {
    position: 'absolute',
    bottom: -2,
    left: 32,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pulseContainer: {
    width: 10,
    height: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusPulse: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  contactDetails: {
    marginLeft: Theme.spacing.md,
  },
  contactName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  contactStatus: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  contactRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  callIconButton: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Theme.spacing.sm,
  },
  chevron: {
    marginLeft: Theme.spacing.xs,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: Theme.spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
    color: Theme.colors.textSecondary,
    fontSize: 14,
    marginTop: Theme.spacing.md,
    lineHeight: 20,
  },
});
