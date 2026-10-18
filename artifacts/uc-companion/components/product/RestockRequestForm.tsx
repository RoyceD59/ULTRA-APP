import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { submitUcRestockRequest } from '@workspace/api-client-react/companion/restock';
import type { RecordVariant } from '@/lib/productRecord';
import type { UCCustomer } from '@/hooks/useApi';
import { P } from './theme';

type Props = {
  productKey: string;
  variants: RecordVariant[];
  variant: RecordVariant | null;
  onVariant: (v: RecordVariant) => void;
  token: string | null;
  profile?: UCCustomer;
};

export function newIdempotencyKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'rs-';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** International format only (+ and country code); national numbers are not guessed. */
export function validPhone(raw: string): boolean {
  return /^\+[1-9]\d{8,14}$/.test(raw.replace(/[\s()-]/g, ''));
}

type Phase = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

function failureMessage(err: unknown, signedIn: boolean): string {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return signedIn ? 'Your sign-in has expired. Sign in again, then retry.' : 'This request was not accepted. Please retry.';
  if (status === 400 || status === 422) return 'Some details were not accepted. Check your name, phone and town, then retry.';
  if (status === 404) return 'This product or option is no longer available for restock requests.';
  if (status === 429) return 'Too many attempts. Wait a minute, then retry.';
  return 'We could not confirm that your request was saved. Check your connection and tap Retry; retrying will not add duplicate pending demand.';
}

/** Restock follow-up request. Must be keyed by account so drafts never cross sign-ins. */
export default function RestockRequestForm({ productKey, variants, variant, onVariant, token, profile }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const busy = useRef(false);
  const keyRef = useRef<{ scope: string; key: string } | null>(null);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!profile || prefilled.current) return;
    prefilled.current = true;
    const full = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
    const ph = profile.billing?.phone || profile.shipping?.phone || '';
    const town = profile.shipping?.city || profile.billing?.city || '';
    setName(n => n || full); setPhone(p => p || ph); setLocation(l => l || town);
  }, [profile]);

  const needsVariant = variants.length > 1 && !variant;
  const scope = `${productKey}|${variant?.childSku ?? ''}`;
  useEffect(() => { setPhase(p => (p.kind === 'saving' ? p : { kind: 'idle' })); }, [scope]);

  const errors = {
    name: name.trim().length < 2 ? 'Enter your name.' : '',
    phone: !validPhone(phone) ? 'Enter your phone with country code, for example +254 712 345 678.' : '',
    location: location.trim().length < 2 ? 'Enter your town or area.' : '',
  };
  const invalid = !!(errors.name || errors.phone || errors.location) || needsVariant;

  const submit = async () => {
    setTouched(true);
    if (busy.current || invalid) return;
    busy.current = true;
    if (!keyRef.current || keyRef.current.scope !== scope) keyRef.current = { scope, key: newIdempotencyKey() };
    setPhase({ kind: 'saving' });
    try {
      const res = await submitUcRestockRequest({
        productKey,
        ...(variant ? { variantSku: variant.childSku } : {}),
        contact: { name: name.trim(), phone: phone.replace(/[\s()-]/g, ''), location: location.trim() },
        idempotencyKey: keyRef.current.key,
      }, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      if (!res?.saved) throw new Error('not saved');
      keyRef.current = null;
      setPhase({ kind: 'saved' });
    } catch (err) {
      setPhase({ kind: 'error', message: failureMessage(err, !!token) });
    } finally { busy.current = false; }
  };

  if (phase.kind === 'saved') {
    return <View style={s.box} accessibilityLiveRegion="polite">
      <View style={s.row}><Ionicons name="checkmark-circle" size={20} color={P.tealDark} /><Text style={s.title}>Request saved</Text></View>
      <Text style={s.body}>{`We have your restock request${variant ? ` for ${variant.label}` : ''}. Our team will contact you on ${phone.trim()} when it can be supplied. This is not an order and nothing has been charged or reserved.`}</Text>
    </View>;
  }

  const saving = phase.kind === 'saving';
  return (
    <View style={s.box} testID="restock-form">
      <Text style={s.title}>Ask us to contact you when it is back</Text>
      <Text style={s.note}>We use these details only to follow up on stock for this product. No account is created and nothing is charged or reserved.</Text>
      {!token ? <Text style={s.note}>Contact details for resolved guest requests are removed after 180 days.</Text> : null}
      {variants.length > 1 ? <View style={{ gap: 6 }}>
        <Text style={s.label}>Option you want</Text>
        <View style={s.chips}>{variants.map(v => {
          const on = variant?.childSku === v.childSku;
          return <TouchableOpacity key={v.childSku} onPress={() => onVariant(v)} accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={[s.chip, on && s.chipOn]}><Text style={[s.chipT, on && { color: '#fff' }]}>{v.label}</Text></TouchableOpacity>;
        })}</View>
        {touched && needsVariant ? <Text style={s.err}>Choose the option you want.</Text> : null}
      </View> : null}
      <Field label="Name" value={name} onChange={setName} error={touched ? errors.name : ''} autoComplete="name" />
      <Field label="Phone" value={phone} onChange={setPhone} error={touched ? errors.phone : ''} autoComplete="tel" keyboard="phone-pad" placeholder="+254 712 345 678" />
      <Field label="Town or area" value={location} onChange={setLocation} error={touched ? errors.location : ''} autoComplete="off" />
      {phase.kind === 'error' ? <Text accessibilityLiveRegion="assertive" style={s.err}>{phase.message}</Text> : null}
      <TouchableOpacity onPress={submit} disabled={saving} accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }}
        style={[s.primary, saving && { opacity: 0.6 }]} testID="restock-submit">
        <Text style={s.primaryT}>{saving ? 'Saving…' : phase.kind === 'error' ? 'Retry' : 'Request a restock call'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Field({ label, value, onChange, error, autoComplete, keyboard, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; error: string;
  autoComplete: 'name' | 'tel' | 'off'; keyboard?: 'phone-pad'; placeholder?: string;
}) {
  return <View style={{ gap: 4 }}>
    <Text style={s.label} nativeID={`rs-${label.replace(/\W/g, '')}`}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} accessibilityLabel={label} aria-labelledby={`rs-${label.replace(/\W/g, '')}`}
      autoComplete={autoComplete} keyboardType={keyboard} placeholder={placeholder} style={[s.input, !!error && { borderColor: P.bad }]} placeholderTextColor={P.muted} />
    {error ? <Text style={s.err}>{error}</Text> : null}
  </View>;
}

const s = StyleSheet.create({
  box: { backgroundColor: P.aqua, borderRadius: 12, borderWidth: 1, borderColor: P.line, padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: P.navy, fontWeight: '700', fontSize: 16 },
  body: { color: P.navy, fontSize: 14, lineHeight: 20 },
  note: { color: P.muted, fontSize: 13, lineHeight: 18 },
  label: { color: P.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  input: { borderWidth: 1, borderColor: P.line, borderRadius: 10, minHeight: 44, paddingHorizontal: 12, backgroundColor: P.ground, color: P.navy, fontSize: 15 },
  err: { color: P.bad, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: P.teal, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center', backgroundColor: P.ground },
  chipOn: { backgroundColor: P.teal },
  chipT: { color: P.tealDark, fontWeight: '600', fontSize: 14 },
  primary: { backgroundColor: P.teal, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryT: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
