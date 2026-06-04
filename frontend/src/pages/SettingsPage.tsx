import React from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity } from 'react-native';
import { useAuth, useLogout } from '../modules/auth/hooks';
import { Theme } from '../theme';
import { GlassCard } from '../components/GlassCard';
import { Avatar } from '../components/Avatar';
import { GlassButton } from '../components/GlassButton';
import { Ionicons } from '@expo/vector-icons';
import { ICE_MODE } from '../config/env';

export function SettingsPage() {
  const { user } = useAuth();
  const logoutMutation = useLogout();

  const getIceModeDescription = (mode: string) => {
    switch (mode) {
      case 'stun':
        return 'STUN Mode (Direct P2P)';
      case 'turn':
        return 'TURN Relay Mode (Relayed P2P)';
      case 'ipv6-direct':
        return 'IPv6 Direct Mode (Direct P2P)';
      default:
        return 'STUN Mode (Direct P2P)';
    }
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>

        <GlassCard style={styles.profileCard}>
          <Avatar username={user?.username || 'User'} size={72} />
          <Text style={styles.username}>{user?.username || 'User'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{user?.role || 'Peer User'}</Text>
          </View>
        </GlassCard>

        <Text style={styles.sectionTitle}>Network Configuration</Text>
        <GlassCard style={styles.settingGroup}>
          <View style={styles.settingItem}>
            <View style={styles.settingItemLeft}>
              <Ionicons name="git-network-outline" size={20} color={Theme.colors.accent} style={styles.settingIcon} />
              <View>
                <Text style={styles.settingLabel}>ICE Mode</Text>
                <Text style={styles.settingSub}>{getIceModeDescription(ICE_MODE)}</Text>
              </View>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{ICE_MODE.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.settingDivider} />

          <View style={styles.settingItem}>
            <View style={styles.settingItemLeft}>
              <Ionicons name="hardware-chip-outline" size={20} color={Theme.colors.accent} style={styles.settingIcon} />
              <View>
                <Text style={styles.settingLabel}>Network Type</Text>
                <Text style={styles.settingSub}>IPv6 Dual Stack Enabled</Text>
              </View>
            </View>
            <View style={styles.activeIndicator} />
          </View>
        </GlassCard>

        <Text style={styles.sectionTitle}>App Details</Text>
        <GlassCard style={styles.settingGroup}>
          <View style={styles.settingItem}>
            <View style={styles.settingItemLeft}>
              <Ionicons name="information-circle-outline" size={20} color={Theme.colors.textSecondary} style={styles.settingIcon} />
              <View>
                <Text style={styles.settingLabel}>Version</Text>
                <Text style={styles.settingSub}>1.0.0 (Expo SDK 54)</Text>
              </View>
            </View>
          </View>

          <View style={styles.settingDivider} />

          <TouchableOpacity style={styles.settingItem} activeOpacity={0.7}>
            <View style={styles.settingItemLeft}>
              <Ionicons name="document-text-outline" size={20} color={Theme.colors.textSecondary} style={styles.settingIcon} />
              <View>
                <Text style={styles.settingLabel}>Developer Logs</Text>
                <Text style={styles.settingSub}>View diagnostics and debug logs</Text>
              </View>
            </View>
            <Text style={styles.comingSoonText}>Coming Soon</Text>
          </TouchableOpacity>
        </GlassCard>

        <View style={styles.buttonContainer}>
          <GlassButton
            title="Log Out"
            variant="destructive"
            onPress={handleLogout}
            loading={logoutMutation.isPending}
          />
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
  profileCard: {
    marginHorizontal: Theme.spacing.md,
    padding: Theme.spacing.lg,
    alignItems: 'center',
    marginBottom: Theme.spacing.lg,
  },
  username: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.md,
  },
  roleBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 4,
    borderRadius: Theme.roundness.full,
    marginTop: Theme.spacing.xs,
  },
  roleText: {
    color: Theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
  },
  settingGroup: {
    marginHorizontal: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
  },
  settingItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingIcon: {
    marginRight: Theme.spacing.md,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  settingSub: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  settingDivider: {
    height: 1,
    backgroundColor: Theme.colors.border,
  },
  badge: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: Theme.roundness.sm,
  },
  badgeText: {
    color: Theme.colors.accent,
    fontSize: 10,
    fontWeight: 'bold',
  },
  activeIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Theme.colors.success,
  },
  comingSoonText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  buttonContainer: {
    marginHorizontal: Theme.spacing.md,
    marginTop: Theme.spacing.md,
  },
});
