import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { removeLocalProfile } from '../modules/auth/api';
import { useAuth, useLogout } from '../modules/auth/hooks';
import { Theme } from '../theme';
import { Avatar } from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '../components/ScreenLayout';
import { NeuCard } from '../components/NeuCard';
import { NeuButton } from '../components/NeuButton';
import { PulsingDot } from '../components/PulsingDot';
import { ConfirmModal } from '../components/ConfirmModal';
import { useNetwork } from '../hooks/useNetwork';
import { useIpv6Status } from '../hooks/useIpv6Status';
import { useNavigation } from '@react-navigation/native';

export function SettingsPage() {
  const { user, isGuest, isExpiredGuest } = useAuth();
  const navigation = useNavigation<any>();
  const logoutMutation = useLogout();
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);

  const { type: netType } = useNetwork();
  const { hasIpv6, loading: loadingIpv6 } = useIpv6Status();
  const handleLogoutConfirm = () => {
    setLogoutConfirmVisible(false);
    logoutMutation.mutate();
  };

  const HeaderComponent = (
    <View style={styles.header}>
      <Text style={styles.title}>Settings</Text>
    </View>
  );

  return (
    <ScreenLayout header={HeaderComponent} scrollable>
      <NeuCard style={styles.profileCard}>
        <Avatar username={user?.username || 'User'} size={72} />
        <Text style={styles.username}>{user?.username || 'User'}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{isGuest ? 'Trial Guest' : user?.role || 'Peer User'}</Text>
        </View>
        {isExpiredGuest && (
          <Text style={styles.guestPrompt}>Your trial access has ended. Log in or create an account to continue.</Text>
        )}
      </NeuCard>

      {isGuest && (
        <>
          <Text style={styles.sectionTitle}>Account</Text>
          <NeuCard style={styles.settingGroup}>
            <View style={styles.guestActions}>
              <NeuButton title="Create Account" onPress={() => navigation.navigate('Register')} />
              <NeuButton title="Log In" variant="secondary" onPress={() => navigation.navigate('Login')} />
            </View>
          </NeuCard>
        </>
      )}

      {!isGuest && (
        <>
          <Text style={styles.sectionTitle}>Account</Text>
          <NeuCard style={styles.settingGroup}>
            <TouchableOpacity style={styles.settingItem} onPress={() => navigation.navigate('ChangePassword')} accessibilityRole="button">
              <View style={styles.settingItemLeft}>
                <Ionicons name="key-outline" size={20} color={Theme.colors.accent} style={styles.settingIcon} />
                <View style={styles.settingItemDetails}>
                  <Text style={styles.settingLabel}>Change password</Text>
                  <Text style={styles.settingSub}>Update your account password</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Theme.colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.settingDivider} />
            <TouchableOpacity style={styles.settingItem} onPress={() => navigation.navigate('RecoveryCodes')} accessibilityRole="button">
              <View style={styles.settingItemLeft}>
                <Ionicons name="shield-checkmark-outline" size={20} color={Theme.colors.accent} style={styles.settingIcon} />
                <View style={styles.settingItemDetails}>
                  <Text style={styles.settingLabel}>Recovery codes</Text>
                  <Text style={styles.settingSub}>Generate a new set of codes</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Theme.colors.textSecondary} />
            </TouchableOpacity>
          </NeuCard>
        </>
      )}

      <Text style={styles.sectionTitle}>Network Configuration</Text>
      <NeuCard style={styles.settingGroup}>
        <View style={styles.settingItem}>
          <View style={styles.settingItemLeft}>
            <Ionicons name="git-network-outline" size={20} color={Theme.colors.accent} style={styles.settingIcon} />
            <View>
              <Text style={styles.settingLabel}>Voice transport</Text>
              <Text style={styles.settingSub}>Native direct IPv6 UDP</Text>
            </View>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              DIRECT
            </Text>
          </View>
        </View>

        <View style={styles.settingDivider} />

        {/* Network Type */}
        <View style={styles.settingItem}>
          <View style={styles.settingItemLeft}>
            <Ionicons name="hardware-chip-outline" size={20} color={Theme.colors.accent} style={styles.settingIcon} />
            <View style={styles.settingItemDetails}>
              <Text style={styles.settingLabel}>Network Type</Text>
              <Text style={styles.settingSub} numberOfLines={1} ellipsizeMode="tail">
                Type: {String(netType || 'Unknown').toUpperCase()} {loadingIpv6 ? '(Checking...)' : ''}
              </Text>
            </View>
          </View>
          <View style={styles.indicatorRow}>
            <PulsingDot
              active={hasIpv6}
              color={hasIpv6 ? Theme.colors.success : Theme.colors.danger}
              size={8}
              pulse={hasIpv6}
            />
            <Text style={styles.indicatorText}>{hasIpv6 ? 'IPv6' : 'IPv4 Only'}</Text>
          </View>
        </View>

        <View style={styles.settingDivider} />

        <View style={styles.settingItem}>
          <View style={styles.settingItemLeft}>
            <Ionicons name="swap-horizontal-outline" size={20} color={Theme.colors.textSecondary} style={styles.settingIcon} />
            <View>
              <Text style={styles.settingLabel}>IPv4 blind relay</Text>
              <Text style={styles.settingSub}>Planned for the next transport phase</Text>
            </View>
          </View>
          <Text style={styles.comingSoonText}>Unavailable</Text>
        </View>
      </NeuCard>

      <Text style={styles.sectionTitle}>App Details</Text>
      <NeuCard style={styles.settingGroup}>
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
      </NeuCard>

      <View style={styles.buttonContainer}>
        <NeuButton
          title="Log Out"
          variant="destructive"
          onPress={() => setLogoutConfirmVisible(true)}
          loading={logoutMutation.isPending}
        />
        {!isGuest && user && <NeuButton
          title="Remove profile from this device"
          variant="destructive"
          onPress={() => Alert.alert('Remove profile from this device?', 'This signs you out and removes this profile’s keys and trusted peers from the device.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove profile', style: 'destructive', onPress: () => {
              void removeLocalProfile().catch(() => undefined);
            } },
          ])}
        />}
      </View>

      <ConfirmModal
        visible={logoutConfirmVisible}
        title="Log Out"
        message="You'll be signed out of VoIPv6."
        confirmLabel="Log Out"
        confirmVariant="destructive"
        loading={logoutMutation.isPending}
        onConfirm={handleLogoutConfirm}
        onCancel={() => setLogoutConfirmVisible(false)}
      />
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
  profileCard: {
    marginHorizontal: Theme.spacing.xs,
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
    borderRadius: 4, // blocky badge
    marginTop: Theme.spacing.xs,
  },
  roleText: {
    color: Theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  guestPrompt: {
    color: Theme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: Theme.spacing.sm,
  },
  guestActions: {
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  settingGroup: {
    marginHorizontal: Theme.spacing.xs,
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
    flex: 1,
  },
  settingItemDetails: {
    flex: 1,
    marginRight: 8,
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
    borderRadius: 4, // blocky badge
  },
  badgeText: {
    color: Theme.colors.accent,
    fontSize: 10,
    fontWeight: 'bold',
  },
  indicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  indicatorText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '600',
  },
  comingSoonText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  buttonContainer: {
    marginHorizontal: Theme.spacing.xs,
    marginTop: Theme.spacing.md,
  },
});
