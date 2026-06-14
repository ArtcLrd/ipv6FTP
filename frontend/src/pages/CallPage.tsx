import React, { useEffect, useRef, useState } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, 
  Platform, PermissionsAndroid, Animated, PanResponder, Dimensions,
  TouchableWithoutFeedback
} from 'react-native';
import { useCallStore } from '../modules/call/store';
import { webrtcManager } from '../modules/call/webrtc';
import { wsManager } from '../realtime/websocket';
import { consumePendingOffer } from '../services/signalingService';
import { logger } from '../core/logger/logger';
import { Theme } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { GridBackground } from '../components/GridBackground';
import { getAvatarColors, getInitials } from '../utils';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

function CallGlow({ active }: { active: boolean }) {
  const glow1 = useRef(new Animated.Value(0)).current;
  const glow2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      glow1.setValue(0);
      glow2.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.loop(
        Animated.timing(glow1, {
          toValue: 1,
          duration: 2500,
          useNativeDriver: true,
        })
      ),
      Animated.loop(
        Animated.sequence([
          Animated.delay(1250),
          Animated.timing(glow2, {
            toValue: 1,
            duration: 2500,
            useNativeDriver: true,
          }),
        ])
      ),
    ]).start();
  }, [active]);

  if (!active) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <Animated.View
        style={[
          styles.glowRing,
          {
            transform: [{ scale: glow1.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] }) }],
            opacity: glow1.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
          },
        ]}
      />
      <Animated.View
        style={[
          styles.glowRing,
          {
            transform: [{ scale: glow2.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] }) }],
            opacity: glow2.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
          },
        ]}
      />
    </View>
  );
}

function DynamicIsland({ remoteUser, callState }: { remoteUser: string, callState: string }) {
  const [expanded, setExpanded] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    Animated.spring(anim, {
      toValue: expanded ? 0 : 1,
      friction: 8,
      tension: 60,
      useNativeDriver: false 
    }).start();
    setExpanded(!expanded);
  };

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: [200, SCREEN_W * 0.85] });
  const height = anim.interpolate({ inputRange: [0, 1], outputRange: [44, 160] });
  const borderRadius = anim.interpolate({ inputRange: [0, 1], outputRange: [22, 30] });
  const contentOpacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const collapsedOpacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] });

  return (
    <TouchableWithoutFeedback onPress={toggle}>
      <Animated.View style={[styles.islandOuter, { width, height, borderRadius }]}>
        <View style={styles.islandInnerWrapper}>
          <View style={[StyleSheet.absoluteFill, styles.glassFallback]} />
          <View style={[StyleSheet.absoluteFill, styles.islandGlassOverlay]} />
          
          <Animated.View style={[styles.islandCollapsed, { opacity: collapsedOpacity }]} pointerEvents={expanded ? 'none' : 'auto'}>
            <Ionicons name="shield-checkmark" size={14} color={Theme.colors.accent} style={{ marginRight: 6 }} />
            <Text style={styles.headerText}>End-to-End Encrypted</Text>
          </Animated.View>

          <Animated.View style={[styles.islandExpanded, { opacity: contentOpacity }]} pointerEvents={expanded ? 'auto' : 'none'}>
            <Text style={styles.islandTitle}>Connection Details</Text>
            <View style={styles.islandRow}>
              <Text style={styles.islandLabel}>Type</Text>
              <Text style={styles.islandValue}>WebRTC Encrypted</Text>
            </View>
            <View style={styles.islandRow}>
              <Text style={styles.islandLabel}>Peer</Text>
              <Text style={styles.islandValue}>{remoteUser || 'Unknown'}</Text>
            </View>
            <View style={styles.islandRow}>
              <Text style={styles.islandLabel}>Status</Text>
              <Text style={styles.islandValue}>{callState.toUpperCase()}</Text>
            </View>
          </Animated.View>
        </View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}

function NeumorphicAvatar({ username }: { username: string }) {
  const initials = getInitials(username || '?');
  const colors = getAvatarColors(username || '?');

  return (
    <View style={styles.avatarOuter}>
      <View style={[StyleSheet.absoluteFill, styles.glassFallback, { borderRadius: 70 }]} />
      <View style={styles.avatarInner}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.start, opacity: 0.4, borderRadius: 60 }]} />
        <Text style={styles.avatarInitials}>{initials}</Text>
      </View>
    </View>
  );
}

function ControlButton({ icon, active, onPress, isDanger = false, isSuccess = false, size = 64, style }: any) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.9, friction: 5, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  };

  const bg = isDanger ? '#e11d48' : isSuccess ? '#10b981' : (active ? 'rgba(56, 189, 248, 0.4)' : 'rgba(0, 24, 40, 0.6)');
  const borderTop = isDanger ? 'rgba(255, 150, 150, 0.6)' : isSuccess ? 'rgba(150, 255, 150, 0.6)' : 'rgba(255, 255, 255, 0.2)';
  const borderBottom = isDanger ? 'rgba(120, 0, 0, 0.8)' : isSuccess ? 'rgba(0, 120, 0, 0.8)' : 'rgba(0, 0, 0, 0.8)';
  const iconColor = active || isDanger || isSuccess ? '#ffffff' : 'rgba(255,255,255,0.7)';

  return (
    <TouchableWithoutFeedback onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={[
        styles.controlBtnOuter, 
        { width: size, height: size, borderRadius: size / 2, transform: [{ scale }] },
        style
      ]}>
        {/* We use tint="dark" exclusively to prevent the Android light blur white box glitch */}
        <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, overflow: 'hidden' }]}>
          {!(isDanger || isSuccess) && <View style={[StyleSheet.absoluteFill, styles.glassFallback]} />}
          <View style={[
            styles.controlBtnInner, 
            { 
              backgroundColor: bg, 
              borderTopColor: borderTop,
              borderBottomColor: borderBottom,
              borderRadius: size / 2,
            }
          ]}>
            <Ionicons 
               name={icon} 
               size={size * 0.45} 
               color={iconColor} 
               style={active || isDanger || isSuccess ? styles.glowingIcon : undefined} 
            />
          </View>
        </View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}

function BottomDrawer({ callState, micMuted, setMicMuted, speakerOn, setSpeakerOn, handleHangup, handleAccept }: any) {
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const [isHeld, setIsHeld] = useState(false);

  const toggle = () => {
    Animated.spring(anim, {
      toValue: open ? 0 : 1,
      friction: 8,
      tension: 50,
      useNativeDriver: true
    }).start();
    setOpen(!open);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 10;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < -30 && !open) toggle();
        else if (gestureState.dy > 30 && open) toggle();
      }
    })
  ).current;

  // Drawer height is 260. 
  // Closed state shifts it down by 140px, so 120px is visible.
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [140, 0] 
  });

  return (
    <Animated.View style={[styles.drawerOuter, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
      <View style={[StyleSheet.absoluteFill, styles.glassFallback, { borderTopLeftRadius: 32, borderTopRightRadius: 32 }]} />
      <View style={[StyleSheet.absoluteFill, styles.drawerOverlay, { borderTopLeftRadius: 32, borderTopRightRadius: 32 }]} />
      <View style={[StyleSheet.absoluteFill, styles.drawerBorder, { borderTopLeftRadius: 32, borderTopRightRadius: 32 }]} pointerEvents="none" />

      <View style={styles.drawerInner}>
        <View style={styles.mainControlsRow}>
          {callState === 'incoming' ? (
            <View style={styles.incomingControls}>
              <View style={styles.levitatingEndCall}>
                <ControlButton icon="call" isSuccess={true} onPress={handleAccept} size={88} />
              </View>
              <View style={styles.levitatingEndCall}>
                 <ControlButton icon="close" isDanger={true} onPress={handleHangup} size={88} />
              </View>
            </View>
          ) : (
            <View style={styles.activeControls}>
              <View style={styles.sideBtnWrap}>
                <ControlButton icon={micMuted ? "mic-off" : "mic"} active={!micMuted} onPress={() => setMicMuted(!micMuted)} size={76} />
              </View>
              <View style={styles.levitatingEndCall}>
                <ControlButton icon="call" isDanger={true} onPress={handleHangup} size={88} />
              </View>
              <View style={styles.sideBtnWrap}>
                <ControlButton icon={speakerOn ? "volume-high" : "volume-medium"} active={speakerOn} onPress={() => setSpeakerOn(!speakerOn)} size={76} />
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.midHandleWrap} onPress={toggle} activeOpacity={0.7}>
          <Ionicons name={open ? "chevron-down" : "chevron-up"} size={28} color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>

        <View style={styles.extraControlsRow}>
          {callState !== 'incoming' && (
            <View style={styles.drawerAction}>
              <ControlButton 
                 icon="pause" 
                 active={isHeld} 
                 onPress={() => setIsHeld(!isHeld)} 
                 size={76}
              />
              <Text style={styles.drawerLabel}>{isHeld ? 'Resume' : 'Hold'}</Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

export function CallPage() {
  const { callState, remoteUser } = useCallStore();
  const [micMuted, setMicMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);

  useEffect(() => {
    if (callState !== 'calling') return;
    const timer = setTimeout(() => {
      logger.info('Call auto-cancelled: 20s timeout reached');
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
              message: 'VoIPv6 needs microphone access for voice calls.',
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
      case 'incoming': return 'Incoming secure call...';
      case 'calling': return 'Calling peer...';
      case 'connecting': return 'Establishing secure channel...';
      case 'connected': return 'Secure connection established';
      default: return 'Disconnected';
    }
  };

  const isConnecting = callState === 'calling' || callState === 'connecting';

  return (
    <GridBackground>
      <View style={styles.container}>
        <View style={styles.topSection}>
          <DynamicIsland remoteUser={remoteUser || 'Unknown'} callState={callState} />
        </View>

        <View style={styles.middleSection}>
          <View style={styles.avatarWrapper}>
            <CallGlow active={isConnecting} />
            <NeumorphicAvatar username={remoteUser || 'Unknown'} />
          </View>
          
          <Text style={styles.usernameText}>{remoteUser || 'Unknown'}</Text>

          <View style={styles.statusCapsuleOuter}>
            <View style={styles.statusCapsuleInner}>
              <View style={[StyleSheet.absoluteFill, styles.glassFallback]} />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 24, 40, 0.4)' }]} />
              <Text style={styles.statusText}>{getStatusText()}</Text>
              {isConnecting && <ActivityIndicator size="small" color={Theme.colors.accent} style={{ marginLeft: 8 }} />}
            </View>
          </View>
        </View>
      </View>
      
      <BottomDrawer 
        callState={callState}
        micMuted={micMuted}
        setMicMuted={setMicMuted}
        speakerOn={speakerOn}
        setSpeakerOn={setSpeakerOn}
        handleHangup={handleHangup}
        handleAccept={handleAccept}
      />
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 260, // accommodate the drawer
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  glassFallback: {
    backgroundColor: 'rgba(7, 16, 19, 0.24)',
  },
  
  // ── Top Section ────────────────────────────────────────────────────────────
  topSection: {
    alignItems: 'center',
    zIndex: 100,
  },
  islandOuter: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
    elevation: 10,
  },
  islandInnerWrapper: {
    flex: 1,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderBottomColor: 'rgba(0, 0, 0, 0.5)',
  },
  islandGlassOverlay: {
    backgroundColor: 'rgba(0, 24, 40, 0.6)',
  },
  islandCollapsed: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  islandExpanded: {
    ...StyleSheet.absoluteFillObject,
    padding: 20,
    justifyContent: 'center',
  },
  islandTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    alignSelf: 'center',
    letterSpacing: 0.5,
  },
  islandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  islandLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
  },
  islandValue: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },

  // ── Middle Section ─────────────────────────────────────────────────────────
  middleSection: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  avatarWrapper: {
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  glowRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.5)',
  },
  avatarOuter: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(0, 24, 40, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  avatarInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  avatarInitials: {
    fontSize: 48,
    fontWeight: '800',
    color: '#ffffff',
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  usernameText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
    marginBottom: 16,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  statusCapsuleOuter: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
    marginTop: 10,
  },
  statusCapsuleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderBottomColor: 'rgba(0,0,0,0.4)',
    minWidth: 160,
  },
  statusText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
    textAlign: 'center',
  },

  // ── Bottom Drawer & Controls ───────────────────────────────────────────────
  drawerOuter: {
    position: 'absolute',
    bottom: 0, // Edge-to-edge at the bottom
    left: 0,
    right: 0,
    height: 260,
    zIndex: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 20,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  drawerInner: {
    flex: 1,
  },
  drawerOverlay: {
    backgroundColor: 'rgba(0, 24, 40, 0.7)',
  },
  drawerBorder: {
    borderTopWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  mainControlsRow: {
    paddingHorizontal: 30,
    height: 90,
    paddingTop: 10,
    justifyContent: 'flex-start',
  },
  activeControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  incomingControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
  },
  sideBtnWrap: {
    marginTop: 24, // Mic and Speaker sit entirely inside the drawer
  },
  levitatingEndCall: {
    marginTop: -44, // 88 / 2 = 44. Exactly centers the 88px button on the top border.
  },
  controlBtnOuter: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  controlBtnInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderLeftColor: 'rgba(255, 255, 255, 0.1)',
    borderRightColor: 'rgba(0, 0, 0, 0.3)',
  },
  glowingIcon: {
    textShadowColor: "rgba(255, 255, 255, 1.0)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  extraControlsRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 20,
  },
  drawerAction: {
    alignItems: 'center',
  },
  drawerLabel: {
    marginTop: 8,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },
  midHandleWrap: {
    height: 30,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
