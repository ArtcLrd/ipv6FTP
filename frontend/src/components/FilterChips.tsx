import React from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { useContactsUIStore, FilterKey } from '../state/contactsUIStore';
import { Theme } from '../theme';

const CHIPS: { label: string; key: FilterKey }[] = [
  { label: 'All', key: 'all' },
  { label: 'Online', key: 'online' },
  { label: 'Offline', key: 'offline' },
  { label: 'IPv6 Ready', key: 'ipv6' },
  { label: 'IPv4 Ready', key: 'ipv4' },
];

export function FilterChips() {
  const { activeFilter, setFilter } = useContactsUIStore();

  return (
    <View style={styles.outerContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        {CHIPS.map((chip) => {
          const isSelected = activeFilter === chip.key;
          return (
            <TouchableOpacity
              key={chip.key}
              activeOpacity={0.8}
              onPress={() => setFilter(chip.key)}
              style={[
                styles.chip,
                isSelected ? styles.chipSelected : styles.chipUnselected,
              ]}
            >
              <Text
                style={[
                  styles.label,
                  isSelected ? styles.labelSelected : styles.labelUnselected,
                ]}
              >
                {chip.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    marginVertical: 8,
  },
  container: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    borderWidth: 1,
  },
  chipUnselected: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  chipSelected: {
    backgroundColor: 'rgba(1, 83, 141, 0.15)',
    borderColor: Theme.colors.accent,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  labelUnselected: {
    color: Theme.colors.textSecondary,
  },
  labelSelected: {
    color: '#ffffff',
  },
});
