import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useAddContact } from '../modules/contacts/hooks';
import { searchUsers } from '../modules/user/api';
import { UserProfile } from '../modules/user/types';
import { logger } from '../core/logger/logger';
import { Theme } from '../theme';
import { GlassCard } from '../components/GlassCard';
import { Avatar } from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';

export function AddUserPage() {
  const addContactMutation = useAddContact();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchUsers(query);
      setSearchResults(results);
    } catch (error) {
      logger.error('Search failed', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddContact = (contactID: string) => {
    addContactMutation.mutate(contactID, {
      onSuccess: () => {
        // Clear search results and query on successful add
        setSearchQuery('');
        setSearchResults([]);
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Add Contact</Text>
          <Text style={styles.subtitle}>Connect with peers in the network</Text>
        </View>

        <View style={styles.searchSection}>
          <Ionicons name="search" size={18} color={Theme.colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by username..."
            placeholderTextColor={Theme.colors.textSecondary}
            value={searchQuery}
            onChangeText={handleSearch}
            autoCapitalize="none"
          />
          {isSearching && <ActivityIndicator size="small" color={Theme.colors.accent} />}
        </View>

        {searchResults.length > 0 && (
          <View style={styles.resultsContainer}>
            <Text style={styles.sectionLabel}>Search Results</Text>
            {searchResults.map((u) => (
              <GlassCard key={u.id} style={styles.resultItem}>
                <View style={styles.userInfo}>
                  <Avatar username={u.username} size={36} />
                  <Text style={styles.userName}>{u.username}</Text>
                </View>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => handleAddContact(u.id)}
                  disabled={addContactMutation.isPending}
                >
                  <Text style={styles.addButtonText}>
                    {addContactMutation.isPending && addContactMutation.variables === u.id
                      ? 'Adding...'
                      : '+ Add'}
                  </Text>
                </TouchableOpacity>
              </GlassCard>
            ))}
          </View>
        )}

        <View style={styles.cardSection}>
          <GlassCard style={styles.qrCard}>
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
          </GlassCard>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  scrollContainer: {
    paddingBottom: Theme.spacing.xl,
  },
  header: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
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
    backgroundColor: 'rgba(23, 28, 32, 0.5)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.roundness.md,
    marginHorizontal: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.sm,
    height: 48,
    marginBottom: Theme.spacing.lg,
  },
  searchIcon: {
    marginRight: Theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: Theme.colors.textPrimary,
    fontSize: 16,
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
    marginHorizontal: Theme.spacing.md,
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
  addButton: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: Theme.colors.accent,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderRadius: Theme.roundness.full,
  },
  addButtonText: {
    color: Theme.colors.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  cardSection: {
    marginHorizontal: Theme.spacing.md,
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
    borderRadius: Theme.roundness.full,
  },
  disabledText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '600',
  },
});
