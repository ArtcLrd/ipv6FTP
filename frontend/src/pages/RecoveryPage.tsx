import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScreenLayout } from '../components/ScreenLayout';
import { GlassInput } from '../components/GlassInput';
import { GlassButton } from '../components/GlassButton';
import { RecoveryCodesPanel } from '../components/RecoveryCodesPanel';
import { Theme } from '../theme';
import { useRecoveryFlow } from '../modules/account/recoveryFlow';

/**
 * Account recovery: identify, prove (saved code or emailed code), choose a new
 * password, then show the replacement saved codes. Success does not sign the
 * user in; every previous session and device is revoked, so they sign in again
 * and re-enroll this phone.
 */
export function RecoveryPage({ navigation }: any) {
  const flow = useRecoveryFlow();
  const { state } = flow;
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== password;

  const finish = () => navigation.reset?.({ index: 0, routes: [{ name: 'Login' }] }) ?? navigation.navigate('Login');

  return (
    <ScreenLayout scrollable contentStyle={styles.content}>
      {state.step === 'identify' && (
        <View>
          <Text style={styles.title}>Recover your account</Text>
          <Text style={styles.body}>
            {state.method === 'saved_code'
              ? 'Enter your username, then one of the recovery codes you saved.'
              : 'Enter the recovery email on your account. If it is verified, we will send a code.'}
          </Text>
          <GlassInput
            label={state.method === 'saved_code' ? 'Username' : 'Recovery email'}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={state.method === 'email' ? 'email-address' : 'default'}
            placeholder={state.method === 'email' ? 'Recovery email' : 'Username'}
          />
          <GlassButton title="Continue" loading={state.pending} disabled={!identifier.trim()} onPress={() => void flow.begin(identifier.trim())} />
          <TouchableOpacity onPress={() => flow.setMethod(state.method === 'saved_code' ? 'email' : 'saved_code')}>
            <Text style={styles.link}>{state.method === 'saved_code' ? 'Use my recovery email instead' : 'Use a saved recovery code instead'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {state.step === 'prove' && (
        <View>
          <Text style={styles.title}>{state.method === 'saved_code' ? 'Enter a recovery code' : 'Enter the emailed code'}</Text>
          <Text style={styles.body}>
            {state.method === 'saved_code'
              ? 'Each saved code works once.'
              : 'If that address is verified on an account, a code was sent. It expires in 10 minutes.'}
          </Text>
          <GlassInput label="Code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="Code" />
          <GlassButton title="Verify" loading={state.pending} disabled={code.trim().length < 8} onPress={() => void flow.prove(code.trim())} />
          <TouchableOpacity onPress={flow.restart}><Text style={styles.link}>Start over</Text></TouchableOpacity>
        </View>
      )}

      {state.step === 'reset' && (
        <View>
          <Text style={styles.title}>Choose a new password</Text>
          <Text style={styles.body}>Use at least 15 characters. A passphrase works well. You will be signed out everywhere.</Text>
          <GlassInput label="New password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="New password" />
          <GlassInput label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" placeholder="Confirm password" error={mismatch ? 'Passwords do not match' : undefined} />
          <GlassButton
            title="Reset password"
            loading={state.pending}
            disabled={Array.from(password).length < 15 || password !== confirm}
            onPress={() => void flow.complete(password)}
          />
          <TouchableOpacity onPress={flow.restart}><Text style={styles.link}>Start over</Text></TouchableOpacity>
        </View>
      )}

      {state.step === 'codes' && state.codes && (
        <RecoveryCodesPanel codes={state.codes} confirmLabel="Go to sign in" onConfirmed={finish} />
      )}

      {!!state.error && <Text style={styles.error} accessibilityRole="alert">{state.error}</Text>}

      {state.step !== 'codes' && (
        <TouchableOpacity onPress={() => navigation.goBack?.()}><Text style={styles.link}>Back to sign in</Text></TouchableOpacity>
      )}
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
