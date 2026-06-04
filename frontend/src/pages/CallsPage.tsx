import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { Theme } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../components/GlassCard';

export function CallsPage() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Call History</Text>
      </View>

      <View style={styles.content}>
        <GlassCard style={styles.card}>
          <Ionicons name="call-outline" size={48} color={Theme.colors.textSecondary} />
          <Text style={styles.emptyTitle}>No Recent Calls</Text>
          <Text style={styles.emptyDesc}>
            Your voice calls are peer-to-peer (P2P), encrypted end-to-end, and are not saved on the server.
          </Text>
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={14} color={Theme.colors.accent} style={styles.shield} />
            <Text style={styles.badgeText}>E2EE Secured</Text>
          </View>
        </GlassCard>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
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
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.md,
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
    borderRadius: Theme.roundness.full,
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
