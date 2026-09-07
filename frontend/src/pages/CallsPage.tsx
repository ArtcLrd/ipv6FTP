import React, { useState } from 'react';
import { Alert, Share, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '../components/ScreenLayout';
import { NeuCard } from '../components/NeuCard';
import { webrtcManager } from '../modules/call/webrtc';
import type { CallInvitation } from '../modules/call/api';
import { handlePossibleQuotaPrompt } from '../modules/prompts/errors';

export function CallsPage() {
  const [joinCode, setJoinCode] = useState('');
  const [invitation, setInvitation] = useState<CallInvitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [quotaNotice, setQuotaNotice] = useState<string | null>(null);

  const createInvite = async () => {
    try {
      setBusy(true);
      const created = await webrtcManager.createInviteCall();
      setInvitation(created);
    } catch (error) {
      const quotaMessage = handlePossibleQuotaPrompt(error);
      if (quotaMessage) {
        setQuotaNotice(quotaMessage);
        return;
      }
      Alert.alert('Call unavailable', error instanceof Error ? error.message : 'Unable to create call invitation.');
    } finally {
      setBusy(false);
    }
  };

  const joinInvite = async () => {
    const code = joinCode.trim();
    if (!code) {
      Alert.alert('Enter code', 'Paste or type the call code first.');
      return;
    }
    try {
      setBusy(true);
      await webrtcManager.joinCallWithCode(code);
      setJoinCode('');
    } catch (error) {
      const quotaMessage = handlePossibleQuotaPrompt(error);
      if (quotaMessage) {
        setQuotaNotice(quotaMessage);
        return;
      }
      Alert.alert('Could not join', error instanceof Error ? error.message : 'The call code is invalid or expired.');
    } finally {
      setBusy(false);
    }
  };

  const shareInvite = async () => {
    if (!invitation) return;
    const parts = [`IPv6FTP call code: ${invitation.fallback_code}`];
    if (invitation.join_url) {
      parts.push(invitation.join_url);
    }
    await Share.share({ message: parts.join('\n') });
  };

  const HeaderComponent = (
    <View style={styles.header}>
      <Text style={styles.title}>Calls</Text>
    </View>
  );

  return (
    <ScreenLayout header={HeaderComponent} scrollable={false}>
      <View style={styles.content}>
        <NeuCard style={styles.card}>
          <Ionicons name="call-outline" size={42} color={Theme.colors.accent} />
          <Text style={styles.emptyTitle}>IPv6 Direct Call</Text>
          <Text style={styles.emptyDesc}>Create a short-lived code or join one from a peer.</Text>
          {quotaNotice && (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>{quotaNotice}</Text>
            </View>
          )}

          <TouchableOpacity style={styles.primaryButton} onPress={createInvite} disabled={busy}>
            <Ionicons name="link" size={18} color="#001018" />
            <Text style={styles.primaryButtonText}>{busy ? 'Working...' : 'Create Code'}</Text>
          </TouchableOpacity>

          {invitation && (
            <View style={styles.inviteBox}>
              <Text style={styles.inviteLabel}>Code</Text>
              <Text style={styles.inviteCode}>{invitation.fallback_code}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={shareInvite}>
                <Ionicons name="share-outline" size={17} color={Theme.colors.accent} />
                <Text style={styles.secondaryButtonText}>Share</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.joinRow}>
            <TextInput
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="Enter code"
              placeholderTextColor={Theme.colors.textSecondary}
              autoCapitalize="characters"
              style={styles.input}
            />
            <TouchableOpacity style={styles.joinButton} onPress={joinInvite} disabled={busy}>
              <Ionicons name="arrow-forward" size={20} color="#001018" />
            </TouchableOpacity>
          </View>

          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={14} color={Theme.colors.accent} style={styles.shield} />
            <Text style={styles.badgeText}>IPv6 only for guests</Text>
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
  primaryButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: 6,
    backgroundColor: Theme.colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: Theme.spacing.md,
  },
  noticeBox: {
    width: '100%',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  noticeText: {
    color: Theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  primaryButtonText: {
    color: '#001018',
    fontSize: 15,
    fontWeight: '800',
  },
  inviteBox: {
    width: '100%',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
  },
  inviteLabel: {
    color: Theme.colors.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  inviteCode: {
    color: Theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: Theme.spacing.sm,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: Theme.colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  joinRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginBottom: Theme.spacing.lg,
  },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    color: Theme.colors.textPrimary,
    paddingHorizontal: Theme.spacing.md,
  },
  joinButton: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: Theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
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
