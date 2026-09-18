import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  COUNTRY_OPTIONS,
  type CountryOption,
  type SupportedCountryCode,
} from '@workspace/api-zod/phone';

export function countryOption(code: string | undefined): CountryOption {
  return COUNTRY_OPTIONS.find((item) => item.code === code) ?? COUNTRY_OPTIONS[0];
}

export function CountryPicker({
  value,
  onChange,
  colors,
  label = 'Country',
}: {
  value: SupportedCountryCode;
  onChange: (code: SupportedCountryCode) => void;
  colors: any;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const selected = countryOption(value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return COUNTRY_OPTIONS;
    return COUNTRY_OPTIONS.filter((item) =>
      item.name.toLowerCase().includes(needle) ||
      item.code.toLowerCase().includes(needle) ||
      item.callingCode.includes(needle),
    );
  }, [query]);

  return (
    <>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected.name}`}
        onPress={() => { setQuery(''); setVisible(true); }}
        style={[styles.trigger, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={{ color: colors.text, flex: 1 }}>{selected.name}</Text>
        <Text style={{ color: colors.mutedForeground }}>{selected.callingCode}⌄</Text>
      </TouchableOpacity>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.background }]} onPress={(event) => event.stopPropagation()}>
            <Text style={[styles.title, { color: colors.text }]}>Choose country</Text>
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search country or calling code"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.search, { color: colors.text, borderColor: colors.border }]}
            />
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => { onChange(item.code); setVisible(false); }}
                  style={[styles.option, { borderBottomColor: colors.border }]}
                >
                  <Text style={{ color: colors.text, flex: 1 }}>{item.name}</Text>
                  <Text style={{ color: colors.mutedForeground }}>{item.callingCode}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={[styles.empty, { color: colors.mutedForeground }]}>No matching country</Text>}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  trigger: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '82%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  title: { fontSize: 19, fontWeight: '700', marginBottom: 12 },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  empty: { paddingVertical: 24, textAlign: 'center' },
});