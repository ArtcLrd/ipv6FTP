import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import axios from 'axios';
import { GlassButton } from '../components/GlassButton';
import { GlassInput } from '../components/GlassInput';
import { ScreenLayout } from '../components/ScreenLayout';
import { newPassword } from '../core/api/contractsV2';
import { changeAccountPassword } from '../modules/account/passwordChange';
import { Theme } from '../theme';

export function ChangePasswordPage({ navigation }: any) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(false);

  const submit = async () => {
    if (flight.current) return;
    if (!current || !newPassword.safeParse(password).success || password !== confirm) {
      setError('Enter your current password and matching new passwords of 15–128 characters.');
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      await changeAccountPassword(current, password);
      setCurrent('');
      setPassword('');
      setConfirm('');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) setError('The current password could not be verified or verification expired. Please try again.');
      else if (axios.isAxiosError(error) && error.response?.status === 400) setError('The new password was not accepted. Choose a different password.');
      else setError('Could not change the password. Check your connection and try again.');
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };

  return <ScreenLayout scrollable contentStyle={styles.content}>
    <View>
      <Text style={styles.title}>Update your password</Text>
      <Text style={styles.body}>Changing your password signs you out on all devices and ends any active call. You can then sign in with the new password.</Text>
      <GlassInput label="Current password" placeholder="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" />
      <GlassInput label="New password" placeholder="New password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
      <GlassInput label="Confirm new password" placeholder="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />
      {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      <GlassButton title="Change password" onPress={() => void submit()} loading={busy} disabled={busy || !current || !password || !confirm} />
      <TouchableOpacity disabled={busy} onPress={() => navigation.goBack()}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
    </View>
  </ScreenLayout>;
}

const styles = StyleSheet.create({
  content: { padding: 24 },
  title: { color: Theme.colors.textPrimary, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  body: { color: Theme.colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  link: { color: Theme.colors.accent, fontSize: 14, textAlign: 'center', marginTop: 16 },
  error: { color: Theme.colors.danger, fontSize: 14, marginBottom: 12 },
});
