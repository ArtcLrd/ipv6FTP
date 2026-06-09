import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useRegister } from '../modules/auth/hooks';
import { getApiErrorMessage } from '../core/api/errors';
import { Theme } from '../theme';
import { BrandColors } from '../theme/colors';
import { GlassInput } from '../components/GlassInput';
import { GlassButton } from '../components/GlassButton';
import { GridBackground } from '../components/GridBackground';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = Math.min(SCREEN_W * 0.88, 400);
const CARD_PADDING = 28;

export function RegisterPage({ navigation, route }: any) {
  // Username may be pre-filled (and locked) when coming from the smart login flow
  const prefillUsername: string = route?.params?.username ?? '';
  const isUsernameLocked = prefillUsername.length > 0;

  const [username, setUsername] = useState(prefillUsername);
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const registerMutation = useRegister();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 9,
        tension: 45,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleRegister = () => {
    if (username.trim().length < 3) {
      setFormError('Username must be at least 3 characters.');
      return;
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    setFormError('');
    registerMutation.mutate({ username: username.trim(), password });
  };

  const errorMessage =
    formError ||
    (registerMutation.isError
      ? getApiErrorMessage(registerMutation.error, 'Registration failed. Try another username.')
      : '');

  return (
    <GridBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Brand Header ───────────────────────────────────────────────── */}
          <Animated.View
            style={[
              styles.headerContainer,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <View style={styles.lightningWrap}>
              <Ionicons 
                name="flash-outline" 
                size={56} 
                color="#FBBF24" 
                style={styles.neonIcon}
              />
            </View>
            <Text style={styles.title}>VoIPv6</Text>
            <Text style={styles.subtitle}>CREATE YOUR PROFILE</Text>
          </Animated.View>

          {/* ── Glass Card ─────────────────────────────────────────────────── */}
          <Animated.View
            style={[
              styles.cardShell,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <View style={styles.cardWrapper}>
              <View style={[StyleSheet.absoluteFill, styles.cardBgOverlay, { borderRadius: 22 }]} />
              <BlurView intensity={30} tint="dark" style={[StyleSheet.absoluteFill, { borderRadius: 22 }]} />
              
              <View style={styles.cardInner}>
                <View style={styles.stepContainer}>
                  
                  <Text style={styles.cardTitle}>New Account</Text>
                  <Text style={styles.cardSubtitle}>
                    {isUsernameLocked
                      ? 'Complete your profile to get started'
                      : 'Choose a username and password'}
                  </Text>

                  {/* Username field */}
                  <View style={styles.inputGroup}>
                    {isUsernameLocked ? (
                      // Locked username — shown as a display badge, not editable
                      <View style={styles.lockedRow}>
                        <View style={styles.lockedField}>
                          <Ionicons name="person-outline" size={16} color={BrandColors.balticBlue} style={styles.lockedIcon} />
                          <Text style={styles.lockedUsername}>{username}</Text>
                        </View>
                        <View style={styles.lockedBadge}>
                          <Ionicons name="checkmark-circle" size={14} color={BrandColors.balticBlue} />
                          <Text style={styles.lockedBadgeText}>available</Text>
                        </View>
                      </View>
                    ) : (
                      <GlassInput
                        placeholder="Username (min 3 chars)"
                        value={username}
                        onChangeText={(val) => {
                          setUsername(val);
                          setFormError('');
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                      />
                    )}
                  </View>

                  {/* Password field */}
                  <View style={styles.inputGroup}>
                    <GlassInput
                      placeholder="Password (min 8 chars)"
                      value={password}
                      onChangeText={(val) => {
                        setPassword(val);
                        setFormError('');
                      }}
                      secureTextEntry
                      autoFocus={isUsernameLocked}
                      returnKeyType="done"
                      onSubmitEditing={handleRegister}
                    />
                  </View>

                  {!!errorMessage && (
                    <View style={styles.errorRow}>
                      <Ionicons name="warning-outline" size={13} color="#ef4444" />
                      <Text style={styles.errorText}>{errorMessage}</Text>
                    </View>
                  )}

                  <View style={styles.spacer} />

                  <GlassButton
                    title="Create Account"
                    onPress={handleRegister}
                    disabled={!username.trim() || !password || registerMutation.isPending}
                    loading={registerMutation.isPending}
                    rightIcon={<Ionicons name="sparkles-outline" size={15} color="#ffffff" />}
                  />

                  <View style={styles.flexSpacer} />

                  <View style={styles.dividerRow}>
                    <View style={styles.divider} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.divider} />
                  </View>

                  <GlassButton
                    title="Back to sign in"
                    variant="secondary"
                    onPress={() => navigation.navigate('Login')}
                  />
                </View>
              </View>
            </View>
          </Animated.View>

          <Animated.Text style={[styles.footerTagline, { opacity: fadeAnim }]}>
            End-to-end encrypted · IPv6 native
          </Animated.Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  kav: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 56,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  headerContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  lightningWrap: {
    marginBottom: 14,
  },
  neonIcon: {
    textShadowColor: '#FBBF24',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: 11,
    color: BrandColors.balticBlue,
    letterSpacing: 2.5,
    fontWeight: '600',
    opacity: 0.85,
    marginTop: 8,
  },

  // ── Glass Card ────────────────────────────────────────────────────────────
  cardShell: {
    width: CARD_W,
    maxWidth: 400,
  },
  cardWrapper: {
    width: '100%',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: Theme.colors.glassBorder,
    overflow: 'hidden',
  },
  cardBgOverlay: {
    backgroundColor: 'rgba(0, 24, 40, 0.60)',
  },
  cardInner: {
    flex: 1,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderBottomWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomColor: 'rgba(0, 0, 0, 0.8)',
    borderRightColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 22,
  },
  stepContainer: {
    padding: CARD_PADDING,
    paddingTop: 45,
    paddingBottom: 28,
    minHeight: 460,
  },

  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  cardSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 28,
    letterSpacing: 0.1,
    textAlign: 'center',
  },

  inputGroup: {
    marginBottom: Theme.spacing.xs,
  },

  // ── Locked username display ───────────────────────────────────────────────
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.md,
    paddingHorizontal: 18,
    height: 52,
    borderRadius: Theme.roundness.pill,
    // Neumorphic extrusion
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomColor: 'rgba(0, 0, 0, 0.8)',
    borderRightColor: 'rgba(0, 0, 0, 0.5)',
    backgroundColor: 'rgba(0, 24, 40, 0.55)',
  },
  lockedField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  lockedIcon: {
    opacity: 0.8,
  },
  lockedUsername: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(1, 83, 141, 0.20)',
  },
  lockedBadgeText: {
    fontSize: 11,
    color: BrandColors.balticBlue,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── Layout helpers ────────────────────────────────────────────────────────
  spacer: {
    height: 18,
  },
  flexSpacer: {
    flex: 1,
  },

  // ── Divider ────────────────────────────────────────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    gap: 12,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
  dividerText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.70)',
    fontWeight: '500',
    letterSpacing: 0.5,
  },

  // ── Error feedback ─────────────────────────────────────────────────────────
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
    marginTop: -4,
    paddingHorizontal: 2,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    letterSpacing: 0.1,
    flex: 1,
  },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footerTagline: {
    marginTop: 28,
    fontSize: 11,
    color: Theme.colors.textMuted,
    letterSpacing: 0.8,
    textAlign: 'center',
  },
});
