import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { GlassCard } from './GlassCard';
import type { GuestPromptReason } from '../modules/prompts/store';

interface Props {
  visible: boolean;
  reason: GuestPromptReason;
  resetAt?: string;
  onSignUp: () => void;
  onSignIn: () => void;
  onSaveForLater: () => void;
}

const copyByReason: Record<GuestPromptReason, { title: string; body: string }> = {
  quota_exhausted: {
    title: 'Your guest quota is used',
    body: 'Create a free account to keep your identity, use registered features, and get unlimited IPv6 calling. IPv4 calls get a fresh daily allowance.',
  },
  weekly_benefits_reminder: {
    title: 'Keep this setup with an account',
    body: 'You can continue as a guest. Signing up keeps your devices and history together, unlocks registered features, and gives unlimited IPv6 access.',
  },
  restricted_feature: {
    title: 'This feature needs an account',
    body: 'Contacts, search, and account-level features are available after sign up. Your current guest device can be upgraded without losing the flow.',
  },
};

export function GuestBenefitsModal({ visible, reason, resetAt, onSignUp, onSignIn, onSaveForLater }: Props) {
  const copy = copyByReason[reason] ?? copyByReason.weekly_benefits_reminder;
  const resetText = reason === 'quota_exhausted' && resetAt
    ? `Guest quota resets ${new Date(resetAt).toLocaleString()}.`
    : null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onSaveForLater}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismissOverlay} activeOpacity={1} onPress={onSaveForLater} />
        <GlassCard style={styles.card}>
          <TouchableOpacity style={styles.closeButton} onPress={onSaveForLater} accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={Theme.colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.iconWrap}>
            <Ionicons name="person-add-outline" size={28} color={Theme.colors.textPrimary} />
          </View>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          {resetText && <Text style={styles.resetText}>{resetText}</Text>}
          <View style={styles.benefits}>
            <Text style={styles.benefit}>Unlimited IPv6 voice and video</Text>
            <Text style={styles.benefit}>Contacts, devices, and account recovery later</Text>
            <Text style={styles.benefit}>30 minutes of IPv4 calling per UTC day</Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.primaryButton} onPress={onSignUp}>
              <Text style={styles.primaryText}>Sign Up</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={onSaveForLater}>
              <Text style={styles.secondaryText}>Save it for later</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={onSignIn}>
            <Text style={styles.signInText}>Already registered? Sign in</Text>
          </TouchableOpacity>
        </GlassCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    padding: Theme.spacing.lg,
  },
  dismissOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    padding: Theme.spacing.lg,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: Theme.spacing.md,
    right: Theme.spacing.md,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: Theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
  },
  title: {
    color: Theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: Theme.spacing.sm,
    paddingRight: Theme.spacing.xl,
  },
  body: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  resetText: {
    color: Theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: Theme.spacing.sm,
  },
  benefits: {
    marginTop: Theme.spacing.md,
    gap: 8,
  },
  benefit: {
    color: Theme.colors.textPrimary,
    fontSize: 13,
  },
  actions: {
    marginTop: Theme.spacing.lg,
    gap: Theme.spacing.sm,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 6,
    backgroundColor: Theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: Theme.colors.textPrimary,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: Theme.colors.textPrimary,
    fontWeight: '700',
  },
  signInText: {
    color: Theme.colors.accent,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: Theme.spacing.md,
  },
});
