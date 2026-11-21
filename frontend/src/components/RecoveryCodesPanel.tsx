import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { GlassButton } from './GlassButton';

interface Props {
  codes: string[];
  /** Called only after the user explicitly confirms they saved the codes. */
  onConfirmed: () => void | Promise<void>;
  confirmLabel?: string;
  busy?: boolean;
}

/**
 * Shows a freshly generated saved-code set once. Acknowledgement is not proof of
 * external storage, so the copy tells users to store the codes offline.
 */
export function RecoveryCodesPanel({ codes, onConfirmed, confirmLabel = 'Continue', busy }: Props) {
  const [saved, setSaved] = useState(false);
  return (
    <View>
      <Text style={styles.title}>Save your recovery codes</Text>
      <Text style={styles.body}>
        Each code works once and lets you regain access if you forget your password. They are shown only now.
        Write them down or keep them in a password manager. Do not share or screenshot them.
      </Text>
      <View style={styles.grid} accessibilityLabel="Recovery codes">
        {codes.map((code) => (
          <Text key={code} style={styles.code} selectable>{code}</Text>
        ))}
      </View>
      <TouchableOpacity
        style={styles.row}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: saved }}
        onPress={() => setSaved((value) => !value)}
      >
        <Ionicons name={saved ? 'checkbox' : 'square-outline'} size={22} color={Theme.colors.accent} />
        <Text style={styles.rowText}>I have saved these recovery codes</Text>
      </TouchableOpacity>
      <GlassButton title={confirmLabel} disabled={!saved} loading={busy} onPress={() => { void onConfirmed(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: Theme.colors.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  body: { color: Theme.colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  grid: { backgroundColor: Theme.colors.surface, borderRadius: 12, padding: 16, marginBottom: 16, gap: 6 },
  code: { color: Theme.colors.textPrimary, fontFamily: 'monospace', fontSize: 14, letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  rowText: { color: Theme.colors.textPrimary, fontSize: 14, flexShrink: 1 },
});
