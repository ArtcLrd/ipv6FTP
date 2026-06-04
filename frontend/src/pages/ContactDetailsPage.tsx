import React from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity, Alert, Platform } from 'react-native';
import { useDeleteContact } from '../modules/contacts/hooks';
import { webrtcManager } from '../modules/call/webrtc';
import { Theme } from '../theme';
import { GlassCard } from '../components/GlassCard';
import { Avatar } from '../components/Avatar';
import { GlassButton } from '../components/GlassButton';
import { Ionicons } from '@expo/vector-icons';

export function ContactDetailsPage({ route, navigation }: any) {
  const { contact } = route.params;
  const deleteContactMutation = useDeleteContact();

  const handleStartCall = () => {
    webrtcManager.startCall(contact);
  };

  const handleDelete = () => {
    Alert.alert(
      'Remove Contact',
      `Are you sure you want to remove ${contact.username} from your contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            deleteContactMutation.mutate(contact.id, {
              onSuccess: () => {
                navigation.goBack();
              },
            });
          },
        },
      ]
    );
  };

  const isOnline = contact.status === 'online';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={Theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Peer Profile</Text>
          <View style={styles.placeholderButton} />
        </View>

        <GlassCard style={styles.profileCard}>
          <Avatar username={contact.username} size={96} />
          <Text style={styles.username}>{contact.username}</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusIndicator,
                { backgroundColor: isOnline ? Theme.colors.success : Theme.colors.textSecondary },
              ]}
            />
            <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
          </View>
        </GlassCard>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionButton} onPress={handleStartCall} activeOpacity={0.7}>
            <Ionicons name="call" size={24} color={Theme.colors.accent} />
            <Text style={styles.actionLabel}>Audio Call</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionButton, styles.actionButtonDisabled]} disabled activeOpacity={0.7}>
            <Ionicons name="videocam" size={24} color={Theme.colors.textSecondary} />
            <Text style={[styles.actionLabel, styles.actionLabelDisabled]}>Video Call</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionButton, styles.actionButtonDisabled]} disabled activeOpacity={0.7}>
            <Ionicons name="chatbubble" size={24} color={Theme.colors.textSecondary} />
            <Text style={[styles.actionLabel, styles.actionLabelDisabled]}>Message</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Network Details</Text>
        <GlassCard style={styles.cardGroup}>
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
        </GlassCard>

        <Text style={styles.sectionTitle}>Activity</Text>
        <GlassCard style={styles.comingSoonCard}>
          <Ionicons name="time-outline" size={24} color={Theme.colors.textSecondary} />
          <Text style={styles.comingSoonText}>Recent call diagnostics will appear here.</Text>
        </GlassCard>

        <View style={styles.buttonContainer}>
          <GlassButton
            title="Remove Contact"
            variant="destructive"
            onPress={handleDelete}
            loading={deleteContactMutation.isPending}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  placeholderButton: {
    width: 32,
  },
  profileCard: {
    marginHorizontal: Theme.spacing.md,
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
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  statusText: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  actionButton: {
    flex: 1,
    backgroundColor: 'rgba(23, 28, 32, 0.5)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.roundness.md,
    paddingVertical: Theme.spacing.md,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  actionButtonDisabled: {
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
    marginLeft: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
  },
  cardGroup: {
    marginHorizontal: Theme.spacing.md,
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
    marginHorizontal: Theme.spacing.md,
    padding: Theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Theme.spacing.lg,
  },
  comingSoonText: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    marginLeft: Theme.spacing.md,
  },
  buttonContainer: {
    marginHorizontal: Theme.spacing.md,
    marginTop: Theme.spacing.md,
  },
});
