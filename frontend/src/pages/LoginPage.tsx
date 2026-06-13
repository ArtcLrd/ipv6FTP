import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { BlurView } from "expo-blur";
import { useLogin } from "../modules/auth/hooks";
import { useCheckUsername } from "../modules/auth/hooks";
import { getApiErrorMessage } from "../core/api/errors";
import { logger } from "../core/logger/logger";
import { Theme } from "../theme";
import { BrandColors } from "../theme/colors";
import { GlassInput } from "../components/GlassInput";
import { GlassButton } from "../components/GlassButton";
import { GridBackground } from "../components/GridBackground";
import { Ionicons } from "@expo/vector-icons";

// ── Flow states ──────────────────────────────────────────────────────────────
type LoginStep = "username" | "password";

const { width: SCREEN_W } = Dimensions.get("window");

// Card is 88% of screen width, capped at 400
const CARD_W = Math.min(SCREEN_W * 0.88, 400);

export function LoginPage({ navigation }: any) {
  const [step, setStep] = useState<LoginStep>("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");


  const checkMutation = useCheckUsername();
  const loginMutation = useLogin();

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
    const isPending = checkMutation.isPending || loginMutation.isPending;
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
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      cardGlow.setValue(0);
    }
  }, [checkMutation.isPending, loginMutation.isPending]);

  const triggerShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(errorShake, {
        toValue: 10,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(errorShake, {
        toValue: -10,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(errorShake, {
        toValue: 7,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(errorShake, {
        toValue: -7,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(errorShake, {
        toValue: 0,
        duration: 55,
        useNativeDriver: true,
      }),
    ]).start();
  }, [errorShake]);

  const transitionToPassword = useCallback(() => {
    // Brief success flash on input
    setInputSuccess(true);
    setTimeout(() => setInputSuccess(false), 600);

    // Fade out username step
    Animated.parallel([
      Animated.timing(usernameOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(usernameSlide, {
        toValue: -24,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setStep("password");
      // Materialise avatar + password step
      Animated.parallel([
        Animated.spring(avatarScale, {
          toValue: 1,
          friction: 7,
          tension: 50,
          useNativeDriver: true,
        }),
        Animated.timing(avatarOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(passwordSlide, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(passwordOpacity, {
          toValue: 1,
          duration: 360,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [
    usernameOpacity,
    usernameSlide,
    avatarScale,
    avatarOpacity,
    passwordSlide,
    passwordOpacity,
  ]);

  const resetToUsername = useCallback(() => {
    passwordOpacity.setValue(0);
    passwordSlide.setValue(28);
    avatarScale.setValue(0);
    avatarOpacity.setValue(0);
    usernameOpacity.setValue(1);
    usernameSlide.setValue(0);
    setStep("username");
    setPassword("");
    loginMutation.reset();
    checkMutation.reset();
  }, [
    passwordOpacity,
    passwordSlide,
    avatarScale,
    avatarOpacity,
    usernameOpacity,
    usernameSlide,
    loginMutation,
    checkMutation,
  ]);

  const handleContinue = useCallback(() => {
    const trimmed = username.trim();
    if (!trimmed) {
      triggerShake();
      return;
    }
    checkMutation.mutate(trimmed, {
      onSuccess: (result) => {
        if (result.exists) {
          transitionToPassword();
        } else {
          navigation.navigate("Register", { username: trimmed });
        }
      },
      onError: (error) => {
        logger.error("Username check failed", getApiErrorMessage(error, "Could not verify username."));
        triggerShake();
      },
    });
  }, [username, checkMutation, transitionToPassword, navigation, triggerShake]);

  const handleLogin = useCallback(() => {
    if (!password) {
      triggerShake();
      return;
    }
    loginMutation.mutate(
      { username: username.trim(), password },
      {
        onError: (error) => {
          logger.error("Login failed", getApiErrorMessage(error, "Wrong password."));
          triggerShake();
        },
      },
    );
  }, [password, loginMutation, username, triggerShake]);

  // Errors are logged only — not shown on the UI.
  // In the future, an opt-in recording feature will capture and report errors.

  const avatarLetter = username.trim().charAt(0).toUpperCase();
  const isPending = checkMutation.isPending || loginMutation.isPending;

  // Derived from mutation state — no manual error state needed.
  // mutation.reset() on onChangeText clears these automatically.
  const usernameError = checkMutation.isError
    ? getApiErrorMessage(checkMutation.error, "Could not verify username.")
    : null;
  const passwordError = loginMutation.isError
    ? getApiErrorMessage(loginMutation.error, "Wrong password.")
    : null;

  // Animated card border colour (pulses during loading)
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
            {/* Outline lightning bolt with text shadow for neon glow */}
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
            {/* Outer: Native-driven shake and shadows */}
            <Animated.View
              style={[
                styles.cardOuter,
                { transform: [{ translateX: errorShake }] },
              ]}
            >
              {/* Inner: JS-driven border color, overflow hidden, borders, blur, content */}
              <Animated.View
                style={[styles.cardWrapper, { borderColor: cardBorderColor }]}
              >
                {/* Absolute BlurView for proper Android rendering */}
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    styles.cardBgOverlay,
                    { borderRadius: 22 },
                  ]}
                />
                <BlurView
                  intensity={30}
                  tint="dark"
                  style={[StyleSheet.absoluteFill, { borderRadius: 22 }]}
                />

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
                      <GlassInput
                        placeholder="Username or Email"
                        value={username}
                        onChangeText={(val) => {
                          setUsername(val);
                          checkMutation.reset();
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                        returnKeyType="go"
                        onSubmitEditing={handleContinue}
                        style={inputSuccess ? styles.inputSuccess : undefined}
                      />

                      {usernameError ? (
                        <View style={styles.errorRow}>
                          <Ionicons name="alert-circle" size={13} color="#f87171" />
                          <Text style={styles.errorText}>{usernameError}</Text>
                        </View>
                      ) : null}

                      <View style={styles.spacer} />

                      <GlassButton
                        title="Continue"
                        onPress={handleContinue}
                        disabled={!username.trim() || isPending}
                        loading={isPending}
                        rightIcon={
                          <Ionicons
                            name="arrow-forward"
                            size={16}
                            color="#ffffff"
                          />
                        }
                      />

                      <View style={styles.flexSpacer} />

                      <View style={styles.dividerRow}>
                        <View style={styles.divider} />
                        <Text style={styles.dividerText}>or</Text>
                        <View style={styles.divider} />
                      </View>

                      <GlassButton
                        title="Create an account"
                        variant="secondary"
                        onPress={() =>
                          navigation.navigate("Register", { username: "" })
                        }
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
                        onPress={resetToUsername}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name="chevron-back"
                          size={13}
                          color={BrandColors.balticBlue}
                        />
                        <Text style={styles.changeUserText}>Not you?</Text>
                      </TouchableOpacity>

                      <GlassInput
                        placeholder="Password"
                        value={password}
                        onChangeText={(val) => {
                          setPassword(val);
                          loginMutation.reset();
                        }}
                        secureTextEntry
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={handleLogin}
                      />

                      {passwordError ? (
                        <View style={styles.errorRow}>
                          <Ionicons name="alert-circle" size={13} color="#f87171" />
                          <Text style={styles.errorText}>{passwordError}</Text>
                        </View>
                      ) : null}

                      <View style={styles.spacer} />

                      <GlassButton
                        title="Sign In"
                        onPress={handleLogin}
                        disabled={!password || isPending}
                        loading={isPending}
                        rightIcon={
                          <Ionicons
                            name="lock-closed"
                            size={14}
                            color="#ffffff"
                          />
                        }
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

// ── Styles ────────────────────────────────────────────────────────────────────

const CARD_PADDING = 28;

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

  // ── Header / Logo ──────────────────────────────────────────────────────────
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

  // ── Card shell (holds shake + fade) ───────────────────────────────────────
  cardShell: {
    width: CARD_W,
    maxWidth: 400,
  },

  // ── Glass Card (Neumorphism + Glassmorphism) ───────────────────────────────
  cardOuter: {
    width: "100%",
    borderRadius: 22,
    // Neumorphic shadow - drop shadow for extrusion
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.8,
    shadowRadius: 40,
  },
  cardWrapper: {
    width: "100%",
    borderRadius: 22,
    borderWidth: 1.5,
    // Base border color which animates
    borderColor: Theme.colors.glassBorder,
    overflow: "hidden",
  },
  cardBgOverlay: {
    // Add glass background color overlay for visibility
    backgroundColor: "rgba(0, 24, 40, 0.60)",
  },
  cardInner: {
    flex: 1,
    // Neumorphism highlight and shadow
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderTopColor: "rgba(255, 255, 255, 0.15)",
    borderLeftColor: "rgba(255, 255, 255, 0.10)",
    borderBottomWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomColor: "rgba(0, 0, 0, 0.8)",
    borderRightColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 22, // matches wrapper
  },
  stepContainer: {
    padding: CARD_PADDING,
    paddingTop: 70,
    paddingBottom: 28,
    minHeight: 410,
  },
  spacer: {
    height: 18,
  },
  flexSpacer: {
    flex: 1,
  },

  // ── Input success flash ────────────────────────────────────────────────────
  inputSuccess: {
    borderColor: Theme.colors.success,
  },

  // ── Avatar (password step) ─────────────────────────────────────────────────
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

  // ── Primary CTA ────────────────────────────────────────────────────────────
  // Removed duplicate primaryBtn styles since we use GlassButton

  // ── Divider ────────────────────────────────────────────────────────────────
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

  // ── Secondary CTA ──────────────────────────────────────────────────────────
  // Removed duplicate secondaryBtn styles since we use GlassButton

  // ── Inline error ────────────────────────────────────────────────────────────
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  errorText: {
    fontSize: 12,
    color: "#f87171",
    fontWeight: "500",
    flexShrink: 1,
  },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footerTagline: {
    marginTop: 28,
    fontSize: 11,
    color: Theme.colors.textMuted,
    letterSpacing: 0.8,
    textAlign: "center",
  },
});
