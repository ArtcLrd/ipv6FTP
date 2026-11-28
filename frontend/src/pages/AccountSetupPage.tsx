import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GlassButton } from '../components/GlassButton';
import { GlassInput } from '../components/GlassInput';
import { RecoveryCodesPanel } from '../components/RecoveryCodesPanel';
import { ScreenLayout } from '../components/ScreenLayout';
import { acknowledgeRecoveryCodes, regenerateRecoveryCodes, requestFreshAuth } from '../modules/account/api';
import { activateSetup, logout } from '../modules/auth/api';
import { currentIdentityGeneration, assertIdentityGeneration } from '../modules/auth/generation';
import { Theme } from '../theme';

export function AccountSetupPage() {
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(false);

  const run = async (work: () => Promise<void>) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try { await work(); }
    catch { setError('Could not complete setup. Check your connection and credentials, then try again.'); }
    finally { flight.current = false; setBusy(false); }
  };

  const generate = () => run(async () => {
    const generation = currentIdentityGeneration();
    const grant = await requestFreshAuth(password, 'recovery_codes');
    assertIdentityGeneration(generation);
    const next = await regenerateRecoveryCodes(grant);
    assertIdentityGeneration(generation);
    setPassword('');
    setCodes(next);
  });

  const confirm = () => run(async () => {
    if (!codes?.length) return;
    const generation = currentIdentityGeneration();
    await acknowledgeRecoveryCodes(codes[0]);
    assertIdentityGeneration(generation);
    await activateSetup();
    setCodes(null);
  });

  return (
    <ScreenLayout scrollable contentStyle={styles.content}>
      {codes ? (
        <RecoveryCodesPanel codes={codes} onConfirmed={confirm} busy={busy} confirmLabel="Finish setup" />
      ) : (
        <View>
          <Text style={styles.title}>Set up account recovery</Text>
          <Text style={styles.body}>Confirm your password to generate recovery codes. Save them somewhere safe so you can recover your account if you forget your password.</Text>
          <GlassInput label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="Password" />
          <GlassButton title="Generate recovery codes" onPress={generate} disabled={!password || busy} loading={busy} />
          <TouchableOpacity disabled={busy} onPress={() => void run(activateSetup)}>
            <Text style={styles.link}>I already saved and confirmed my codes</Text>
          </TouchableOpacity>
        </View>
      )}
      {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      <TouchableOpacity disabled={busy} onPress={() => void logout().catch(() => undefined)}><Text style={styles.link}>Sign out</Text></TouchableOpacity>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 12 },
  title: { color: Theme.colors.textPrimary, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  body: { color: Theme.colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  link: { color: Theme.colors.accent, fontSize: 14, textAlign: 'center', marginTop: 16 },
  error: { color: Theme.colors.danger, fontSize: 14, marginTop: 12 },
});
