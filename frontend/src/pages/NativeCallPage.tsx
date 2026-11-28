import React from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { useCallStore } from '../modules/call/store';
import { nativeVoiceCoordinator } from '../modules/call/nativeVoice';

const statusCopy: Record<string, string> = {
  waiting: 'Share the code and keep this screen open.',
  awaiting_acceptance: 'The call creator must accept before secure setup starts.',
  handshaking: 'Establishing an end-to-end encrypted Noise session…',
  verifying: 'Compare this code through the same trusted channel used to share the call code.',
  discovering: 'Discovering both public IPv6 UDP endpoints…',
  connecting: 'Proving direct reachability in both directions…',
  active: 'Direct encrypted IPv6 voice is active.',
  ended: 'The call has ended.',
  failed: 'The direct call could not be established.',
};

export function NativeCallPage() {
  const call = useCallStore();
  const busy = ['handshaking', 'discovering', 'connecting'].includes(call.callState);
  const creatorMustAccept = call.callState === 'awaiting_acceptance' && call.role === 'creator';
  const needsVerification = call.callState === 'verifying' && !call.verificationRemembered;

  const shareCode = async () => {
    if (call.invitationCode) await Share.share({ message: `IPv6FTP call code: ${call.invitationCode}` });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.securityBadge}>
        <Ionicons name="shield-checkmark" size={18} color={Theme.colors.accent} />
        <Text style={styles.securityText}>Noise encrypted · direct IPv6 UDP</Text>
      </View>

      <View style={styles.center}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={64} color={Theme.colors.accent} />
        </View>
        <Text style={styles.peer}>{call.remoteUser || 'Waiting for peer'}</Text>
        <Text style={styles.status}>{statusCopy[call.callState] || call.callState}</Text>
        {busy && <ActivityIndicator color={Theme.colors.accent} size="large" style={styles.progress} />}

        {call.invitationCode && call.callState === 'waiting' && (
          <View style={styles.codeCard}>
            <Text style={styles.label}>CALL CODE</Text>
            <Text style={styles.callCode}>{call.invitationCode}</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={shareCode}>
              <Ionicons name="share-outline" size={18} color={Theme.colors.accent} />
              <Text style={styles.secondaryText}>Share code</Text>
            </TouchableOpacity>
          </View>
        )}

        {call.callState === 'awaiting_acceptance' && (
          <View style={styles.codeCard}>
            <Text style={styles.label}>{creatorMustAccept ? 'JOIN REQUEST' : 'WAITING FOR CREATOR'}</Text>
            <Text style={styles.detail}>
              {creatorMustAccept ? `${call.remoteUser || 'A peer'} entered your code.` : 'Your device identity will be shown after acceptance.'}
            </Text>
            {creatorMustAccept && (
              <TouchableOpacity style={styles.primaryButton} onPress={() => nativeVoiceCoordinator.acceptParticipant()}>
                <Text style={styles.primaryText}>Accept participant</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {call.callState === 'verifying' && call.verificationCode && (
          <View style={styles.codeCard}>
            <Text style={styles.label}>{call.verificationRemembered ? 'REMEMBERED DEVICE' : 'COMPARE ON BOTH DEVICES'}</Text>
            <Text style={styles.verificationCode}>{call.verificationCode}</Text>
            {needsVerification ? (
              <TouchableOpacity style={styles.primaryButton} onPress={() => nativeVoiceCoordinator.confirmVerification()}>
                <Text style={styles.primaryText}>Codes match</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.detail}>The previously verified device key matches.</Text>
            )}
          </View>
        )}

        {call.error && <Text style={styles.error}>{call.error}</Text>}
      </View>

      <View style={styles.controls}>
        {call.callState === 'active' && (
          <>
            <TouchableOpacity style={[styles.roundButton, call.muted && styles.selected]} onPress={() => nativeVoiceCoordinator.setMuted(!call.muted)}>
              <Ionicons name={call.muted ? 'mic-off' : 'mic'} size={25} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.roundButton, call.speaker && styles.selected]} onPress={() => nativeVoiceCoordinator.setSpeaker(!call.speaker)}>
              <Ionicons name={call.speaker ? 'volume-high' : 'volume-medium'} size={25} color="#fff" />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={[styles.roundButton, styles.hangup]} onPress={() => nativeVoiceCoordinator.hangUp()}>
          <Ionicons name="call" size={27} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.colors.background, padding: Theme.spacing.lg },
  securityBadge: { marginTop: 28, alignSelf: 'center', flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: 1, borderColor: Theme.colors.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  securityText: { color: Theme.colors.textSecondary, fontSize: 13, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 132, height: 132, borderRadius: 66, borderWidth: 1, borderColor: Theme.colors.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.surface },
  peer: { color: Theme.colors.textPrimary, fontSize: 26, fontWeight: '800', marginTop: 22 },
  status: { color: Theme.colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10, maxWidth: 330 },
  progress: { marginTop: 22 },
  codeCard: { width: '100%', maxWidth: 380, marginTop: 26, borderWidth: 1, borderColor: Theme.colors.border, borderRadius: 10, backgroundColor: Theme.colors.surface, padding: 20, alignItems: 'center' },
  label: { color: Theme.colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  callCode: { color: Theme.colors.textPrimary, fontSize: 31, fontWeight: '900', letterSpacing: 2, marginVertical: 14 },
  verificationCode: { color: Theme.colors.accent, fontSize: 25, fontWeight: '900', letterSpacing: 2, marginVertical: 18 },
  detail: { color: Theme.colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 10 },
  primaryButton: { width: '100%', minHeight: 48, borderRadius: 7, backgroundColor: Theme.colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  primaryText: { color: '#001018', fontWeight: '900' },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 8 },
  secondaryText: { color: Theme.colors.accent, fontWeight: '700' },
  error: { color: '#fb7185', textAlign: 'center', marginTop: 18, maxWidth: 340 },
  controls: { minHeight: 110, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22 },
  roundButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: 'rgba(56, 189, 248, 0.35)', borderColor: Theme.colors.accent },
  hangup: { backgroundColor: '#e11d48', borderColor: '#fb7185', transform: [{ rotate: '135deg' }] },
});
