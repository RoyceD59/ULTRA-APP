import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { validateCustomerContact } from '@workspace/api-zod/customer-contact';
import { CountryPicker } from '@/components/CountryPicker';
import type { SupportedCountryCode } from '@workspace/api-zod/phone';

/** Inline completion keeps the original cart/service/booking form mounted. */
export default function ContactCompletion() {
  const { user, updateUser } = useAuth();
  if (!user || validateCustomerContact(user).ok) return null;
  return <ContactForm key={user.id} accountId={user.id} phone={user.phone} address={user.address ?? ''}
    save={updateUser} />;
}

function ContactForm({ accountId, phone: initialPhone, address: initialAddress, save }: {
  accountId: number; phone: string; address: string;
  save: ReturnType<typeof useAuth>['updateUser'];
}) {
  const api = useApi(), colors = useColors();
  const { user } = useAuth();
  const [phone, setPhone] = useState(initialPhone);
  const [address, setAddress] = useState(initialAddress);
  const [country, setCountry] = useState<SupportedCountryCode>('KE');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeId = React.useRef(user?.id);
  activeId.current = user?.id;
  React.useEffect(() => () => { activeId.current = undefined; }, []);
  async function complete() {
    if (busy) return;
    const contact = validateCustomerContact({ phone, address, country });
    if (!contact.ok) { setError(Object.values(contact.fields).join(' ')); return; }
    setBusy(true); setError('');
    try {
      await api.updateProfile({ phone: contact.phone!, address: contact.address });
      if (activeId.current !== accountId) return;
      await save({ phone: contact.phone!, address: contact.address });
    } catch (e) { if (activeId.current === accountId) setError(e instanceof Error ? e.message : 'Could not save contact details.'); }
    finally { if (activeId.current === accountId) setBusy(false); }
  }
  return <View style={{ borderWidth: 1, borderColor: colors.border, padding: 16, borderRadius: 12, gap: 10 }}>
    <Text style={{ color: colors.text, fontWeight: '700' }}>Complete your contact details</Text>
    <Text style={{ color: colors.mutedForeground }}>Your account is already signed in. Save a phone number and contact address to continue. Your form stays here.</Text>
    <CountryPicker value={country} onChange={setCountry} colors={colors} label="Phone country" />
    <TextInput accessibilityLabel="Contact phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad"
      placeholder="Phone number" style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 12 }} />
    <TextInput accessibilityLabel="Contact address" value={address} onChangeText={setAddress}
      placeholder="Street, building and town" maxLength={500} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 12 }} />
    {!!error && <Text accessibilityLiveRegion="polite" style={{ color: colors.destructive }}>{error}</Text>}
    <TouchableOpacity accessibilityRole="button" onPress={complete} disabled={busy}>
      {busy ? <ActivityIndicator /> : <Text style={{ color: colors.primary }}>Save contact details and continue</Text>}
    </TouchableOpacity>
  </View>;
}