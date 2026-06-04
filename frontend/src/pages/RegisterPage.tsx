import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Animated } from 'react-native';
import { useRegister } from '../modules/auth/hooks';
import { getApiErrorMessage } from '../core/api/errors';
import { Theme } from '../theme';
import { GlassCard } from '../components/GlassCard';
import { GlassInput } from '../components/GlassInput';
import { GlassButton } from '../components/GlassButton';
import { Ionicons } from '@expo/vector-icons';

export function RegisterPage({ navigation }: any) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const registerMutation = useRegister();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

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

  const errorMessage = formError || (
    registerMutation.isError
      ? getApiErrorMessage(registerMutation.error, 'Registration failed. Try another username.')
      : ''
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], width: '100%' }}>
          <View style={styles.headerContainer}>
            <View style={styles.logoRow}>
              <Ionicons name="flash" size={42} color="#fbbf24" style={styles.logoIcon} />
              <Text style={styles.title}>VoIPv6</Text>
            </View>
            <Text style={styles.subtitle}>Create your profile</Text>
          </View>

          <GlassCard style={styles.card}>
            <Text style={styles.cardTitle}>Sign Up</Text>

            <GlassInput
              placeholder="Username (min 3 chars)"
              value={username}
              onChangeText={(val) => {
                setUsername(val);
                setFormError('');
              }}
              autoCapitalize="none"
            />

            <GlassInput
              placeholder="Password (min 8 chars)"
              value={password}
              onChangeText={(val) => {
                setPassword(val);
                setFormError('');
              }}
              secureTextEntry
            />

            {!!errorMessage && (
              <Text style={styles.errorText}>{errorMessage}</Text>
            )}

            <GlassButton
              title="Create Account"
              variant="primary"
              onPress={handleRegister}
              loading={registerMutation.isPending}
              disabled={!username.trim() || !password}
              style={styles.button}
            />
          </GlassCard>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <GlassButton
              title="Log In"
              variant="secondary"
              onPress={() => navigation.navigate('Login')}
              style={styles.loginButton}
            />
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Theme.spacing.lg,
    alignItems: 'center',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: Theme.spacing.xl,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Theme.spacing.xs,
  },
  logoIcon: {
    marginRight: Theme.spacing.xs,
  },
  title: {
    ...Theme.typography.brandTitle,
    color: Theme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: Theme.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  card: {
    padding: Theme.spacing.lg,
    width: '90%',
    maxWidth: 420,
    minWidth: 280,
    alignSelf: 'center',
  },
  cardTitle: {
    ...Theme.typography.cardTitle,
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.lg,
    textAlign: 'center',
  },
  errorText: {
    color: Theme.colors.danger,
    fontSize: 14,
    marginBottom: Theme.spacing.md,
    textAlign: 'center',
  },
  button: {
    marginTop: Theme.spacing.md,
  },
  footer: {
    alignItems: 'center',
    marginTop: Theme.spacing.xl,
  },
  footerText: {
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.sm,
  },
  loginButton: {
    width: 'auto',
    paddingHorizontal: Theme.spacing.xl,
  },
});
