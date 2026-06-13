import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, PermissionsAndroid, Animated } from 'react-native';
import { useCallStore } from '../modules/call/store';
import { webrtcManager } from '../modules/call/webrtc';
import { wsManager } from '../realtime/websocket';
import { consumePendingOffer } from '../services/signalingService';
import { logger } from '../core/logger/logger';
import { Theme } from '../theme';
import { Avatar } from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '../components/ScreenLayout';

function CallGlow({ active }: { active: boolean }) {
  const glow1 = React.useRef(new Animated.Value(0)).current;
  const glow2 = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!active) {
      glow1.setValue(0);
      glow2.setValue(0);
      return;
    }

    const startAnimation = () => {
      glow1.setValue(0);
      glow2.setValue(0);

      Animated.parallel([
        Animated.loop(
          Animated.timing(glow1, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          })
        ),
        Animated.loop(
          Animated.sequence([
            Animated.delay(1000),
            Animated.timing(glow2, {
              toValue: 1,
              duration: 2000,
              useNativeDriver: true,
            }),
          ])
        ),
      ]).start();
    };

    startAnimation();
  }, [active]);

  if (!active) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.glowRing,
          {
            transform: [
              {
                scale: glow1.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 2.2],
                }),
              },
            ],
            opacity: glow1.interpolate({
              inputRange: [0, 1],
              outputRange: [0.5, 0],
            }),
          },
        ]}
      />
      <Animated.View
        style={[
          styles.glowRing,
          {
            transform: [
              {
                scale: glow2.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 2.2],
                }),
              },
            ],
            opacity: glow2.interpolate({
              inputRange: [0, 1],
              outputRange: [0.5, 0],
            }),
          },
        ]}
      />
    </View>
  );
}

export function CallPage() {
  const { callState, remoteUser } = useCallStore();

  useEffect(() => {
    if (callState !== 'calling') return;
    const timer = setTimeout(() => {
      logger.info('Call auto-cancelled: 20s timeout reached');
      // Notify remote peer before tearing down
      wsManager.send('call-ended', {});
      webrtcManager.cleanup();
    }, 20000);
    return () => clearTimeout(timer);
  }, [callState]);

  useEffect(() => {
    async function askMicPermission() {
      try {
        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            {
              title: 'Microphone Permission',
              message: 'Nocturnal needs microphone access for voice calls.',
              buttonPositive: 'Allow',
              buttonNegative: 'Deny',
            }
          );
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            logger.warn('Mic permission denied');
          }
        }
      } catch (e) {
        logger.warn('Mic permission request failed', e);
      }
    }

    const pending = consumePendingOffer();
    if (pending && webrtcManager) {
      webrtcManager.setIncomingOffer(pending.offer);
      useCallStore.getState().setCallState('incoming');
    }

    askMicPermission();
  }, []);

  const handleHangup = () => {
    if (remoteUser) {
      wsManager.send('call-ended', {});
    }
    webrtcManager.cleanup();
  };

  const handleAccept = () => {
    webrtcManager.acceptCall();
  };

  const getStatusText = () => {
    switch (callState) {
      case 'incoming':
        return 'Incoming secure call...';
      case 'calling':
        return 'Calling peer...';
      case 'connecting':
        return 'Establishing secure channel...';
      case 'connected':
        return 'Secure connection established';
      default:
        return 'Disconnected';
    }
  };

  return (
    <ScreenLayout scrollable={false} contentStyle={styles.containerOverride}>
      <View style={styles.header}>
        <Ionicons name="shield-checkmark" size={18} color={Theme.colors.accent} style={styles.shieldIcon} />
        <Text style={styles.headerText}>End-to-End Encrypted</Text>
      </View>

      <View style={styles.profileSection}>
        <View style={styles.avatarOutline}>
          <CallGlow active={callState === 'calling' || callState === 'connecting'} />
          <Avatar username={remoteUser || 'Unknown'} size={120} />
          {(callState === 'calling' || callState === 'connecting') && (
            <ActivityIndicator style={styles.loader} size="large" color={Theme.colors.accent} />
          )}
        </View>
        <Text style={styles.remoteUser}>{remoteUser || 'Unknown'}</Text>
        <Text style={styles.statusText}>{getStatusText()}</Text>
      </View>

      <View style={styles.controlsSection}>
        {/* Placeholder sub-controls only for active call */}
        {callState === 'connected' && (
          <View style={styles.subControls}>
            <TouchableOpacity
              style={[styles.circleButton, styles.circleButtonDisabled]}
              disabled
            >
              <Ionicons name="mic-off" size={22} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.circleButton, styles.circleButtonDisabled]} disabled>
              <Ionicons name="keypad" size={22} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.circleButton, styles.circleButtonDisabled]}
              disabled
            >
              <Ionicons name="volume-mute" size={22} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.mainButtons}>
          {callState === 'incoming' ? (
            <View style={styles.incomingRow}>
              <TouchableOpacity
                style={[styles.callButton, styles.acceptButton]}
                onPress={handleAccept}
                activeOpacity={0.7}
              >
                <Ionicons name="call" size={28} color="#fff" />
                <Text style={styles.buttonLabel}>Accept</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.callButton, styles.hangupButton]}
                onPress={handleHangup}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={28} color="#fff" />
                <Text style={styles.buttonLabel}>Decline</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.callButton, styles.hangupButton, styles.singleHangup]}
              onPress={handleHangup}
              activeOpacity={0.7}
            >
              <Ionicons name="call-outline" size={28} color="#fff" style={styles.rotatedCallIcon} />
              <Text style={styles.buttonLabel}>
                {callState === 'calling' || callState === 'connecting' ? 'Cancel' : 'End Call'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  containerOverride: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.md,
    paddingHorizontal: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Theme.spacing.md,
  },
  shieldIcon: {
    marginRight: 6,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  profileSection: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  avatarOutline: {
    padding: Theme.spacing.md,
    borderRadius: Theme.roundness.full,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.1)',
    position: 'relative',
    marginBottom: Theme.spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1.5,
    borderColor: Theme.colors.accent,
  },
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  remoteUser: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    letterSpacing: 1,
  },
  statusText: {
    fontSize: 16,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.sm,
    fontWeight: '500',
  },
  controlsSection: {
    paddingHorizontal: Theme.spacing.xl,
    marginBottom: Theme.spacing.lg,
  },
  subControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: Theme.spacing.xl,
  },
  circleButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  circleButtonDisabled: {
    opacity: 0.4,
  },
  circleButtonActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    borderColor: Theme.colors.accent,
  },
  mainButtons: {
    alignItems: 'center',
  },
  incomingRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  callButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: Theme.colors.success,
  },
  hangupButton: {
    backgroundColor: Theme.colors.danger,
  },
  singleHangup: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  rotatedCallIcon: {
    transform: [{ rotate: '135deg' }],
  },
  buttonLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
    marginTop: 4,
    position: 'absolute',
    bottom: -20,
    textAlign: 'center',
    width: 100,
  },
});
