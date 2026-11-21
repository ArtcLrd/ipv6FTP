import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import axios from 'axios';
import { GlassButton } from '../components/GlassButton';
import { GlassInput } from '../components/GlassInput';
import { RecoveryCodesPanel } from '../components/RecoveryCodesPanel';
import { ScreenLayout } from '../components/ScreenLayout';
import { acknowledgeRecoveryCodes, regenerateRecoveryCodes, requestFreshAuth } from '../modules/account/api';
import { assertIdentityGeneration, currentIdentityGeneration } from '../modules/auth/generation';
import { Theme } from '../theme';

export function RecoveryCodesPage({ navigation }: any) {
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(false);
  const currentCodes = useRef<string[] | null>(null);
  const allowLeave = useRef(false);
  const screenGeneration = useRef(currentIdentityGeneration());

  useEffect(() => navigation.addListener('beforeRemove', (event: any) => {
    if (currentIdentityGeneration() !== screenGeneration.current || allowLeave.current || (!flight.current && !currentCodes.current)) return;
    event.preventDefault();
    if (flight.current) return;
    Alert.alert('Leave without confirming?', 'Your new recovery codes are shown only now. You may need to generate another set.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => { allowLeave.current = true; navigation.dispatch(event.data.action); } },
    ]);
  }), [navigation]);

  const generate = async () => {
    if (flight.current || !password) return;
    flight.current = true;
    setBusy(true);
    setError('');
    const generation = currentIdentityGeneration();
    let submitted = false;
    try {
      const grant = await requestFreshAuth(password, 'recovery_codes');
      assertIdentityGeneration(generation);
      submitted = true;
      const next = await regenerateRecoveryCodes(grant);
      assertIdentityGeneration(generation);
      setPassword('');
      currentCodes.current = next;
      setCodes(next);
    } catch (error) {
      try { assertIdentityGeneration(generation); } catch { return; }
      setError(submitted
        ? 'The new codes could not be confirmed. Your previous codes may no longer work. Generate another set and save it.'
        : axios.isAxiosError(error) && error.response?.status === 403
          ? 'Your password could not be verified. Please try again.'
          : 'Could not verify your password. Check your connection and try again.');
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (flight.current || !currentCodes.current?.length) return;
    flight.current = true;
    setBusy(true);
    setError('');
    const generation = currentIdentityGeneration();
    try {
      await acknowledgeRecoveryCodes(currentCodes.current[0]);
      assertIdentityGeneration(generation);
      currentCodes.current = null;
      setCodes(null);
      allowLeave.current = true;
      navigation.goBack();
    } catch (error) {
      try { assertIdentityGeneration(generation); } catch { return; }
      setError(axios.isAxiosError(error) && error.response?.status === 409
        ? 'These codes have been replaced. Generate and save another set.'
        : 'Could not confirm the codes. Keep them saved and try confirming again.');
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };

  const startAgain = () => {
    Alert.alert('Generate another set?', 'The codes on this screen will be replaced when you generate another set.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', onPress: () => { currentCodes.current = null; setCodes(null); setError(''); } },
    ]);
  };

  return <ScreenLayout scrollable contentStyle={styles.content}>
    {codes ? (
      <View>
        <RecoveryCodesPanel codes={codes} onConfirmed={confirm} busy={busy} confirmLabel="Done" />
        <TouchableOpacity disabled={busy} onPress={startAgain}><Text style={styles.link}>Generate another set</Text></TouchableOpacity>
      </View>
    ) : (
      <View>
        <Text style={styles.title}>Recovery codes</Text>
        <Text style={styles.body}>Generating a new set makes all previous recovery codes unusable. Enter your password, then save the new codes somewhere safe.</Text>
        <GlassInput label="Password" placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" editable={!busy} />
        <GlassButton title="Generate new codes" onPress={() => void generate()} disabled={!password || busy} loading={busy} />
        <TouchableOpacity disabled={busy} onPress={() => navigation.goBack()}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
      </View>
    )}
    {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
  </ScreenLayout>;
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 12 },
  title: { color: Theme.colors.textPrimary, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  body: { color: Theme.colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  link: { color: Theme.colors.accent, fontSize: 14, textAlign: 'center', marginTop: 16 },
  error: { color: Theme.colors.danger, fontSize: 14, marginTop: 12 },
});
