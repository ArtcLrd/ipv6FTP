import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useDeleteContact } from '../modules/contacts/hooks';
import { webrtcManager } from '../modules/call/webrtc';
import { Theme } from '../theme';
import { Avatar } from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '../components/ScreenLayout';
import { NeuCard } from '../components/NeuCard';
import { NeuButton } from '../components/NeuButton';
import { PulsingDot } from '../components/PulsingDot';
import { ConfirmModal } from '../components/ConfirmModal';

export function ContactDetailsPage({ route, navigation }: any) {
  const { contact } = route.params;
  const deleteContactMutation = useDeleteContact();
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);

  const handleStartCall = () => {
    webrtcManager.startCall(contact);
  };

  const handleDeleteConfirm = () => {
    setDeleteConfirmVisible(false);
    deleteContactMutation.mutate(contact.id, {
      onSuccess: () => {
        navigation.goBack();
      },
    });
  };

  const isOnline = contact.status === 'online';

  const HeaderComponent = (
    <View style={styles.header}>
      <NeuButton
        variant="secondary"
        size="sm"
        onPress={() => navigation.goBack()}
        leftIcon={<Ionicons name="arrow-back" size={20} color={Theme.colors.textPrimary} />}
        title=""
        style={styles.backButton}
      />
      <Text style={styles.title}>Peer Profile</Text>
      <View style={styles.placeholderButton} />
    </View>
  );

  return (
    <ScreenLayout header={HeaderComponent} scrollable>
      <NeuCard style={styles.profileCard}>
        <Avatar username={contact.username} size={96} />
        <Text style={styles.username}>{contact.username}</Text>
        <View style={styles.statusRow}>
          <PulsingDot
            active={isOnline}
            color={isOnline ? Theme.colors.success : Theme.colors.textSecondary}
            size={10}
            pulse={isOnline}
          />
          <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>
      </NeuCard>

      <View style={styles.actionRow}>
        <NeuCard pressable onPress={handleStartCall} style={styles.actionCard}>
          <Ionicons name="call" size={24} color={Theme.colors.accent} />
          <Text style={styles.actionLabel}>Audio Call</Text>
        </NeuCard>

        <NeuCard style={[styles.actionCard, styles.actionCardDisabled]}>
          <Ionicons name="videocam" size={24} color={Theme.colors.textSecondary} />
          <Text style={[styles.actionLabel, styles.actionLabelDisabled]}>Video Call</Text>
        </NeuCard>

        <NeuCard style={[styles.actionCard, styles.actionCardDisabled]}>
          <Ionicons name="chatbubble" size={24} color={Theme.colors.textSecondary} />
          <Text style={[styles.actionLabel, styles.actionLabelDisabled]}>Message</Text>
        </NeuCard>
      </View>

      <Text style={styles.sectionTitle}>Network Details</Text>
      <NeuCard style={styles.cardGroup}>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>Peer ID</Text>
          <Text style={styles.detailValue} numberOfLines={1}>{contact.id}</Text>
        </View>

        <View style={styles.detailDivider} />

        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>IP Address</Text>
          <Text style={styles.detailValue}>
            {contact.ip_addr || 'Unavailable (Offline)'}
          </Text>
        </View>
      </NeuCard>

      <Text style={styles.sectionTitle}>Activity</Text>
      <NeuCard style={styles.comingSoonCard}>
        <Ionicons name="time-outline" size={24} color={Theme.colors.textSecondary} />
        <Text style={styles.comingSoonText}>Recent call diagnostics will appear here.</Text>
      </NeuCard>

      <View style={styles.buttonContainer}>
        <NeuButton
          title="Remove Contact"
          variant="destructive"
          onPress={() => setDeleteConfirmVisible(true)}
          loading={deleteContactMutation.isPending}
        />
      </View>

      <ConfirmModal
        visible={deleteConfirmVisible}
        title="Remove Contact"
        message={`Are you sure you want to remove ${contact.username} from your contacts?`}
        confirmLabel="Remove"
        confirmVariant="destructive"
        loading={deleteContactMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirmVisible(false)}
      />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  placeholderButton: {
    width: 40,
  },
  profileCard: {
    marginHorizontal: Theme.spacing.xs,
    padding: Theme.spacing.xl,
    alignItems: 'center',
    marginBottom: Theme.spacing.lg,
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Theme.spacing.sm,
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: Theme.spacing.xs,
    marginBottom: Theme.spacing.lg,
    gap: 8,
  },
  actionCard: {
    flex: 1,
    paddingVertical: Theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCardDisabled: {
    opacity: 0.4,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.accent,
    marginTop: Theme.spacing.xs,
  },
  actionLabelDisabled: {
    color: Theme.colors.textSecondary,
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
  cardGroup: {
    marginHorizontal: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
  },
  detailLabel: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 13,
    color: Theme.colors.textPrimary,
    fontWeight: '600',
    maxWidth: '70%',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 0.5,
  },
  detailDivider: {
    height: 1,
    backgroundColor: Theme.colors.border,
  },
  comingSoonCard: {
    marginHorizontal: Theme.spacing.xs,
    padding: Theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Theme.spacing.lg,
    gap: 12,
  },
  comingSoonText: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    flex: 1,
  },
  buttonContainer: {
    marginHorizontal: Theme.spacing.xs,
    marginTop: Theme.spacing.md,
  },
});
