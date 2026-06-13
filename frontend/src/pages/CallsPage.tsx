import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '../components/ScreenLayout';
import { NeuCard } from '../components/NeuCard';

export function CallsPage() {
  const HeaderComponent = (
    <View style={styles.header}>
      <Text style={styles.title}>Call History</Text>
    </View>
  );

  return (
    <ScreenLayout header={HeaderComponent} scrollable={false}>
      <View style={styles.content}>
        <NeuCard style={styles.card}>
          <Ionicons name="call-outline" size={48} color={Theme.colors.textSecondary} />
          <Text style={styles.emptyTitle}>No Recent Calls</Text>
          <Text style={styles.emptyDesc}>
            Your voice calls are peer-to-peer (P2P), encrypted end-to-end, and are not saved on the server.
          </Text>
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={14} color={Theme.colors.accent} style={styles.shield} />
            <Text style={styles.badgeText}>E2EE Secured</Text>
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
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    padding: Theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
  },
  emptyDesc: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Theme.spacing.lg,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 4, // blocky badge
  },
  shield: {
    marginRight: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.accent,
  },
});
