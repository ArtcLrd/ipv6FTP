import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useAddContact } from '../modules/contacts/hooks';
import { searchUsers } from '../modules/user/api';
import { UserProfile } from '../modules/user/types';
import { logger } from '../core/logger/logger';
import { Theme } from '../theme';
import { Avatar } from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '../components/ScreenLayout';
import { NeuCard } from '../components/NeuCard';
import { NeuButton } from '../components/NeuButton';
import { InlineError } from '../components/InlineError';

export function AddUserPage() {
  const addContactMutation = useAddContact();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const latestSearchId = useRef(0);

  const handleSearch = async (query: string) => {
    const searchId = latestSearchId.current + 1;
    latestSearchId.current = searchId;
    setSearchQuery(query);
    addContactMutation.reset(); // Clear previous add error
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchUsers(query);
      if (latestSearchId.current === searchId) {
        setSearchResults(results);
      }
    } catch (error) {
      if (latestSearchId.current === searchId) {
        setSearchResults([]);
        logger.error('Search failed', error);
      }
    } finally {
      if (latestSearchId.current === searchId) {
        setIsSearching(false);
      }
    }
  };

  const handleAddContact = (contactID: string) => {
    addContactMutation.mutate(contactID, {
      onSuccess: () => {
        setSearchQuery('');
        setSearchResults([]);
      },
    });
  };

  const HeaderComponent = (
    <View style={styles.header}>
      <Text style={styles.title}>Add Contact</Text>
      <Text style={styles.subtitle}>Connect with peers in the network</Text>
    </View>
  );

  const isConflictError =
    addContactMutation.error &&
    (addContactMutation.error as any).response?.status === 409;

  return (
    <ScreenLayout header={HeaderComponent} scrollable>
      <View style={styles.searchSection}>
        <Ionicons name="search" size={18} color={Theme.colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by username..."
          placeholderTextColor={Theme.colors.textSecondary}
          value={searchQuery}
          onChangeText={handleSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {isSearching && <ActivityIndicator size="small" color={Theme.colors.accent} />}
      </View>

      <View style={styles.errorSection}>
        <InlineError
          type="validation"
          message="Enter at least 3 characters to search."
          visible={searchQuery.length > 0 && searchQuery.length < 3}
        />
        <InlineError
          type="info"
          message="No users found."
          visible={searchQuery.length >= 3 && !isSearching && searchResults.length === 0}
        />
        <InlineError
          type="warn"
          message="Already in your contacts."
          visible={!!isConflictError}
        />
      </View>

      {searchResults.length > 0 && (
        <View style={styles.resultsContainer}>
          <Text style={styles.sectionLabel}>Search Results</Text>
          {searchResults.map((u) => (
            <NeuCard key={u.id} style={styles.resultItem}>
              <View style={styles.userInfo}>
                <Avatar username={u.username} size={36} />
                <Text style={styles.userName}>{u.username}</Text>
              </View>
              <NeuButton
                title={
                  addContactMutation.isPending && addContactMutation.variables === u.id
                    ? 'Adding'
                    : '+ Add'
                }
                size="sm"
                variant="primary"
                loading={addContactMutation.isPending && addContactMutation.variables === u.id}
                disabled={addContactMutation.isPending}
                onPress={() => handleAddContact(u.id)}
              />
            </NeuCard>
          ))}
        </View>
      )}

      <View style={styles.cardSection}>
        <NeuCard style={styles.qrCard}>
          <View style={styles.iconContainer}>
            <Ionicons name="qr-code-outline" size={32} color={Theme.colors.textSecondary} />
          </View>
          <Text style={styles.qrTitle}>QR Scan Code</Text>
          <Text style={styles.qrDesc}>
            Scanner coming soon. Share your username directly to search and add peer connections.
          </Text>
          <View style={styles.disabledBadge}>
            <Text style={styles.disabledText}>Coming Soon</Text>
          </View>
        </NeuCard>
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  searchSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.neu.cardSurface,
    borderWidth: 1,
    borderTopColor: Theme.neu.shadowLight,
    borderLeftColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomColor: Theme.neu.shadowDark,
    borderRightColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: Theme.neu.cardRadius,
    marginHorizontal: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    height: 48,
    marginBottom: Theme.spacing.sm,
  },
  searchIcon: {
    marginRight: Theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: Theme.colors.textPrimary,
    fontSize: 16,
  },
  errorSection: {
    marginHorizontal: Theme.spacing.xs,
    marginBottom: Theme.spacing.md,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Theme.spacing.sm,
    marginLeft: Theme.spacing.xs,
  },
  resultsContainer: {
    marginHorizontal: Theme.spacing.xs,
    marginBottom: Theme.spacing.lg,
  },
  resultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userName: {
    color: Theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: Theme.spacing.md,
  },
  cardSection: {
    marginHorizontal: Theme.spacing.xs,
    marginTop: Theme.spacing.md,
  },
  qrCard: {
    padding: Theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  qrTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.xs,
  },
  qrDesc: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Theme.spacing.md,
  },
  disabledBadge: {
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 4,
    borderRadius: 4, // blocky badge
  },
  disabledText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '600',
  },
});
