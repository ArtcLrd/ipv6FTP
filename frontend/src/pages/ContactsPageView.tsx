import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Contact } from '../modules/contacts/types';
import { Theme } from '../theme';
import { Avatar } from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '../components/ScreenLayout';
import { NeuCard } from '../components/NeuCard';
import { NeuButton } from '../components/NeuButton';
import { PulsingDot } from '../components/PulsingDot';
import { FilterChips } from '../components/FilterChips';
import { ScreenState } from '../components/ui/ScreenState';

interface ContactsPageViewProps {
  user: any;
  filteredContacts: Contact[];
  loadingContacts: boolean;
  refetchContacts: () => void;
  localSearch: string;
  setLocalSearch: (val: string) => void;
  showFilters: boolean;
  setShowFilters: (val: boolean) => void;
  hasIpv6: boolean;
  activeFilter: string;
  onlineCount: number;
  error: unknown;
  onContactPress: (contact: Contact) => void;
  onCallPress: (contact: Contact) => void;
}

export function ContactsPageView({
  user,
  filteredContacts,
  loadingContacts,
  refetchContacts,
  localSearch,
  setLocalSearch,
  showFilters,
  setShowFilters,
  hasIpv6,
  activeFilter,
  onlineCount,
  error,
  onContactPress,
  onCallPress,
}: ContactsPageViewProps) {
  const renderContact = ({ item }: { item: Contact }) => {
    const isOnline = item.status === 'online';

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onContactPress(item)}
        accessibilityRole="button"
        accessibilityLabel={`View details for ${item.username}`}
      >
        <NeuCard style={styles.contactCard}>
          <View style={styles.contactLeft}>
            <View style={styles.avatarWrapper}>
              <Avatar username={item.username} size={44} />
              <View style={styles.statusIndicatorContainer}>
                <PulsingDot active={isOnline} color={isOnline ? Theme.colors.success : Theme.colors.textSecondary} size={10} pulse={isOnline} />
              </View>
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
              onPress={() => onCallPress(item)}
              accessibilityRole="button"
              accessibilityLabel={`Call ${item.username}`}
            >
              <Ionicons name="call" size={18} color={Theme.colors.accent} />
            </TouchableOpacity>
            <Ionicons name="chevron-forward" size={20} color={Theme.colors.textSecondary} style={styles.chevron} />
          </View>
        </NeuCard>
      </TouchableOpacity>
    );
  };

  const HeaderComponent = (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Text style={styles.welcomeText}>Hello,</Text>
        <Text style={styles.usernameText} numberOfLines={1} ellipsizeMode="tail">
          {user?.username || 'User'}
        </Text>
      </View>
      <View style={styles.headerRight}>
        <PulsingDot active={hasIpv6} color={hasIpv6 ? Theme.colors.success : Theme.colors.danger} size={10} pulse={hasIpv6} />
        <Text style={styles.ipv6Label}>{hasIpv6 ? 'IPv6 Ready' : 'IPv4 Only'}</Text>
      </View>
    </View>
  );

  const isEmpty = !loadingContacts && filteredContacts.length === 0;

  return (
    <ScreenLayout header={HeaderComponent} scrollable={false} contentStyle={styles.containerOverride}>
      <View style={styles.searchRow}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={Theme.colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Filter contacts..."
            placeholderTextColor={Theme.colors.textSecondary}
            value={localSearch}
            onChangeText={setLocalSearch}
            accessibilityLabel="Search contacts input"
          />
          {localSearch.length > 0 && (
            <TouchableOpacity 
              onPress={() => setLocalSearch('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search input"
            >
              <Ionicons name="close-circle" size={18} color={Theme.colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        <NeuButton
          variant={activeFilter !== 'all' || showFilters ? 'primary' : 'secondary'}
          size="sm"
          onPress={() => setShowFilters(!showFilters)}
          leftIcon={<Ionicons name="funnel-outline" size={18} color="#ffffff" />}
          title=""
          style={styles.filterToggleBtn}
          accessibilityLabel="Toggle filters options"
        />
      </View>

      {(showFilters || activeFilter !== 'all') && <FilterChips />}

      <View style={styles.infoRow}>
        <Text style={styles.onlineCountText}>{onlineCount} contacts online</Text>
      </View>

      <ScreenState
        isLoading={loadingContacts && filteredContacts.length === 0}
        error={error}
        isEmpty={isEmpty}
        emptyMessage={
          localSearch 
            ? 'No matching contacts.' 
            : 'No contacts yet. Go to the Add tab to find peers!'
        }
        onRetry={refetchContacts}
      >
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
        />
      </ScreenState>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  containerOverride: {
    paddingHorizontal: 0,
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  headerLeft: {
    flex: 1,
    marginRight: 16,
    flexShrink: 1,
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 4,
    gap: 8,
  },
  ipv6Label: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
    gap: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.neu.cardSurface,
    borderWidth: 1,
    borderTopColor: Theme.neu.shadowLight,
    borderLeftColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomColor: Theme.neu.shadowDark,
    borderRightColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: Theme.neu.cardRadius,
    paddingHorizontal: Theme.spacing.sm,
    height: 44, // 44px min touch target
  },
  searchIcon: {
    marginRight: Theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    color: Theme.colors.textPrimary,
    fontSize: 14,
  },
  filterToggleBtn: {
    height: 44, // 44px min touch target
    width: 44,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoRow: {
    paddingHorizontal: Theme.spacing.md,
    marginVertical: Theme.spacing.xs,
  },
  onlineCountText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
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
  avatarWrapper: {
    position: 'relative',
  },
  statusIndicatorContainer: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
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
    width: 44, // 44px min touch target
    height: 44,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Theme.spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  chevron: {
    marginLeft: Theme.spacing.xs,
  },
});
