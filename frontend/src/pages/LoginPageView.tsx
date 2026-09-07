import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { Theme } from "../theme";
import { BrandColors } from "../theme/colors";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { GridBackground } from "../components/GridBackground";
import { Ionicons } from "@expo/vector-icons";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = Math.min(SCREEN_W * 0.88, 400);
const CARD_PADDING = 28;

export interface LoginPageViewRef {
  triggerShake: () => void;
  transitionToPassword: (onComplete: () => void) => void;
  resetToUsername: (onComplete: () => void) => void;
}

interface LoginPageViewProps {
  username: string;
  setUsername: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  step: "username" | "password";
  isPending: boolean;
  usernameError: string | null;
  passwordError: string | null;
  onContinue: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onBackToUsername: () => void;
}

export const LoginPageView = forwardRef<LoginPageViewRef, LoginPageViewProps>(
  (
    {
      username,
      setUsername,
      password,
      setPassword,
      step,
      isPending,
      usernameError,
      passwordError,
      onContinue,
      onLogin,
      onRegister,
      onBackToUsername,
    },
    ref
  ) => {
    // ── Entrance animations ─────────────────────────────────────────────────────
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(50)).current;
    const logoScale = useRef(new Animated.Value(0.7)).current;
    const logoOpacity = useRef(new Animated.Value(0)).current;

    // ── Step transition animations ──────────────────────────────────────────────
    const usernameOpacity = useRef(new Animated.Value(1)).current;
    const usernameSlide = useRef(new Animated.Value(0)).current;
    const passwordOpacity = useRef(new Animated.Value(0)).current;
    const passwordSlide = useRef(new Animated.Value(28)).current;
    const avatarScale = useRef(new Animated.Value(0)).current;
    const avatarOpacity = useRef(new Animated.Value(0)).current;

    // ── Error feedback ──────────────────────────────────────────────────────────
    const errorShake = useRef(new Animated.Value(0)).current;

    // ── Input success flash ─────────────────────────────────────────────────────
    const [inputSuccess, setInputSuccess] = useState(false);

    // ── Card glow pulse (loading state) ────────────────────────────────────────
    const cardGlow = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      // Staggered entrance: logo first, then card slides up
      Animated.sequence([
        Animated.parallel([
          Animated.timing(logoOpacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.spring(logoScale, {
            toValue: 1,
            friction: 7,
            tension: 50,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.spring(slideAnim, {
            toValue: 0,
            friction: 9,
            tension: 45,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }, []);

    // ── Pulse the card border while a request is in flight ─────────────────────
    useEffect(() => {
      if (isPending) {
        const pulse = Animated.loop(
          Animated.sequence([
            Animated.timing(cardGlow, {
              toValue: 1,
              duration: 700,
              useNativeDriver: false,
            }),
            Animated.timing(cardGlow, {
              toValue: 0,
              duration: 700,
              useNativeDriver: false,
            }),
          ])
        );
        pulse.start();
        return () => pulse.stop();
      } else {
        cardGlow.setValue(0);
      }
    }, [isPending]);

    // Expose animations triggers to container
    useImperativeHandle(ref, () => ({
      triggerShake() {
        Animated.sequence([
          Animated.timing(errorShake, { toValue: 10, duration: 55, useNativeDriver: true }),
          Animated.timing(errorShake, { toValue: -10, duration: 55, useNativeDriver: true }),
          Animated.timing(errorShake, { toValue: 7, duration: 55, useNativeDriver: true }),
          Animated.timing(errorShake, { toValue: -7, duration: 55, useNativeDriver: true }),
          Animated.timing(errorShake, { toValue: 0, duration: 55, useNativeDriver: true }),
        ]).start();
      },
      transitionToPassword(onComplete) {
        setInputSuccess(true);
        setTimeout(() => setInputSuccess(false), 600);

        Animated.parallel([
          Animated.timing(usernameOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.timing(usernameSlide, { toValue: -24, duration: 220, useNativeDriver: true }),
        ]).start(() => {
          onComplete();
          Animated.parallel([
            Animated.spring(avatarScale, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }),
            Animated.timing(avatarOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.spring(passwordSlide, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
            Animated.timing(passwordOpacity, { toValue: 1, duration: 360, useNativeDriver: true }),
          ]).start();
        });
      },
      resetToUsername(onComplete) {
        passwordOpacity.setValue(0);
        passwordSlide.setValue(28);
        avatarScale.setValue(0);
        avatarOpacity.setValue(0);
        usernameOpacity.setValue(1);
        usernameSlide.setValue(0);
        onComplete();
      },
    }));

    const avatarLetter = username.trim().charAt(0).toUpperCase();
    const cardBorderColor = cardGlow.interpolate({
      inputRange: [0, 1],
      outputRange: ["rgba(1,83,141,0.28)", "rgba(1,83,141,0.70)"],
    });

    return (
      <GridBackground>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
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
                { opacity: logoOpacity, transform: [{ scale: logoScale }] },
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
            </Animated.View>

            {/* ── Glass Card ─────────────────────────────────────────────────── */}
            <Animated.View
              style={[
                styles.cardShell,
                { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
              ]}
            >
              <Animated.View
                style={[
                  styles.cardOuter,
                  { transform: [{ translateX: errorShake }] },
                ]}
              >
                <Animated.View
                  style={[styles.cardWrapper, { borderColor: cardBorderColor }]}
                >
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      styles.cardBgOverlay,
                      { borderRadius: 22 },
                    ]}
                  />
                  <View style={[StyleSheet.absoluteFill, styles.cardGlassFallback, { borderRadius: 22 }]} />

                  <View style={styles.cardInner}>
                    {/* ── USERNAME STEP ─────────────────────────────────────────── */}
                    {step === "username" && (
                      <Animated.View
                        style={[
                          styles.stepContainer,
                          {
                            opacity: usernameOpacity,
                            transform: [{ translateY: usernameSlide }],
                          },
                        ]}
                      >
                        <Input
                          placeholder="Username or Email"
                          value={username}
                          onChangeText={setUsername}
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoFocus
                          returnKeyType="go"
                          onSubmitEditing={onContinue}
                          style={inputSuccess ? styles.inputSuccess : undefined}
                          error={usernameError}
                        />

                        <View style={styles.spacer} />

                        <Button
                          title="Continue"
                          onPress={onContinue}
                          disabled={!username.trim() || isPending}
                          loading={isPending}
                        />

                        <View style={styles.flexSpacer} />

                        <View style={styles.dividerRow}>
                          <View style={styles.divider} />
                          <Text style={styles.dividerText}>or</Text>
                          <View style={styles.divider} />
                        </View>

                        <Button
                          title="Create an account"
                          variant="secondary"
                          onPress={onRegister}
                        />
                      </Animated.View>
                    )}

                    {/* ── PASSWORD STEP ─────────────────────────────────────────── */}
                    {step === "password" && (
                      <Animated.View
                        style={[
                          styles.stepContainer,
                          {
                            opacity: passwordOpacity,
                            transform: [{ translateY: passwordSlide }],
                          },
                        ]}
                      >
                        {/* Avatar */}
                        <View style={styles.avatarRow}>
                          <Animated.View
                            style={[
                              styles.avatarCircle,
                              {
                                opacity: avatarOpacity,
                                transform: [{ scale: avatarScale }],
                              },
                            ]}
                          >
                            <Text style={styles.avatarLetter}>
                              {avatarLetter}
                            </Text>
                          </Animated.View>
                        </View>

                        <Text style={styles.welcomeUsername}>
                          {username.trim()}
                        </Text>

                        <TouchableOpacity
                          style={styles.changeUserBtn}
                          onPress={onBackToUsername}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name="chevron-back"
                            size={13}
                            color={BrandColors.balticBlue}
                          />
                          <Text style={styles.changeUserText}>Not you?</Text>
                        </TouchableOpacity>

                        <Input
                          placeholder="Password"
                          value={password}
                          onChangeText={setPassword}
                          secureTextEntry
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={onLogin}
                          error={passwordError}
                        />

                        <View style={styles.spacer} />

                        <Button
                          title="Sign In"
                          onPress={onLogin}
                          disabled={!password || isPending}
                          loading={isPending}
                        />
                      </Animated.View>
                    )}
                  </View>
                </Animated.View>
              </Animated.View>
            </Animated.View>

            {/* ── Footer ─────────────────────────────────────────────────────── */}
            <Animated.Text style={[styles.footerTagline, { opacity: fadeAnim }]}>
              End-to-end encrypted · IPv6 native
            </Animated.Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </GridBackground>
    );
  }
);

const styles = StyleSheet.create({
  kav: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 56,
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 32,
  },
  lightningWrap: {
    marginBottom: 14,
  },
  neonIcon: {
    textShadowColor: "#FBBF24",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.6,
  },
  cardShell: {
    width: CARD_W,
    maxWidth: 400,
  },
  cardOuter: {
    width: "100%",
    borderRadius: 22,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.8,
    shadowRadius: 40,
  },
  cardWrapper: {
    width: "100%",
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: Theme.colors.glassBorder,
    overflow: "hidden",
  },
  cardBgOverlay: {
    backgroundColor: "rgba(0, 24, 40, 0.60)",
  },
  cardGlassFallback: {
    backgroundColor: "rgba(7, 16, 19, 0.22)",
  },
  cardInner: {
    flex: 1,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderTopColor: "rgba(255, 255, 255, 0.15)",
    borderLeftColor: "rgba(255, 255, 255, 0.10)",
    borderBottomWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomColor: "rgba(0, 0, 0, 0.8)",
    borderRightColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 22,
  },
  stepContainer: {
    padding: CARD_PADDING,
    paddingTop: 60,
    paddingBottom: 28,
    minHeight: 390,
  },
  spacer: {
    height: 18,
  },
  flexSpacer: {
    flex: 1,
  },
  inputSuccess: {
    borderColor: Theme.colors.success,
  },
  avatarRow: {
    alignItems: "center",
    marginBottom: 10,
  },
  avatarCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(1, 83, 141, 0.18)",
    borderWidth: 2,
    borderColor: "rgba(1, 83, 141, 0.50)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 22,
    fontWeight: "700",
    color: "#ffffff",
  },
  welcomeUsername: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  changeUserBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    marginBottom: 22,
  },
  changeUserText: {
    fontSize: 13,
    color: BrandColors.balticBlue,
    fontWeight: "500",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 18,
    gap: 12,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.30)",
  },
  dividerText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.70)",
    fontWeight: "500",
    letterSpacing: 0.5,
  },
  footerTagline: {
    marginTop: 28,
    fontSize: 11,
    color: Theme.colors.textMuted,
    letterSpacing: 0.8,
    textAlign: "center",
  },
});
