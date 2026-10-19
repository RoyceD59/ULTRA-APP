import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Platform, ActivityIndicator, KeyboardAvoidingView, Keyboard,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import * as Haptics from 'expo-haptics';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

export default function EnquiryScreen() {
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName: string }>();
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const api = useApi();

  const [name, setName]       = useState(user ? `${user.firstName} ${user.lastName}`.trim() : '');
  const [email, setEmail]     = useState(user?.email ?? '');
  const [phone, setPhone]     = useState(user?.phone ?? '');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [error, setError]           = useState('');
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const messageRef = useRef<TextInput>(null);

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim() || !phone.trim() || !message.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    Keyboard.dismiss();
    setError('');
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await api.createEnquiry({
        productId: parseInt(productId ?? '0'),
        productName: productName ?? 'Product',
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        message: message.trim(),
      });
      setSubmitted(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <View style={[styles.successWrap, { backgroundColor: colors.background }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.successLight }]}>
          <Ionicons name="checkmark-circle" size={56} color={colors.success} />
        </View>
        <Text style={[styles.successTitle, { color: colors.text }]}>We'll be in touch!</Text>
        <Text style={[styles.successBody, { color: colors.mutedForeground }]}>
          Your enquiry about{' '}
          <Text style={{ fontWeight: '700' }}>{productName}</Text>{' '}
          has been received. Our team will contact you within 24 hours.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.doneBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.8}>
          <Text style={[styles.doneBtnText, { color: colors.primaryForeground }]}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      {/* Header */}
      <View style={[styles.header, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Enquire</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}>

        {/* Product badge */}
        <View style={[styles.productBadge, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
          <Ionicons name="water-outline" size={18} color={colors.primary} />
          <Text style={[styles.productBadgeText, { color: colors.primary }]} numberOfLines={1}>
            {productName}
          </Text>
        </View>

        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Fill in your details below and our team will get back to you with pricing and availability within 24 hours.
        </Text>

        {/* Fields */}
        <View style={styles.fields}>
          <Field label="Full name" value={name} onChangeText={setName} inputRef={undefined}
            placeholder="Your name" autoComplete="name" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} colors={colors} />
          <Field label="Email" value={email} onChangeText={setEmail} inputRef={emailRef}
            placeholder="you@example.com" keyboardType="email-address"
            autoCapitalize="none" autoComplete="email" returnKeyType="next" onSubmitEditing={() => phoneRef.current?.focus()} colors={colors} />
          <Field label="Phone number" value={phone} onChangeText={setPhone} inputRef={phoneRef}
            placeholder="+254 7XX XXX XXX" keyboardType="phone-pad" autoComplete="tel" returnKeyType="next" onSubmitEditing={() => messageRef.current?.focus()} colors={colors} />
          <Field label="Message" value={message} onChangeText={setMessage} inputRef={messageRef}
            placeholder={`Tell us more about what you need — quantity, size, intended use, or any questions about ${productName ?? 'this product'}.`}
            multiline numberOfLines={4} autoCapitalize="sentences" returnKeyType="done" onSubmitEditing={handleSubmit} colors={colors} />
        </View>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: '#FEF2F2', borderColor: colors.destructive }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
          style={[styles.submitBtn, { backgroundColor: submitting ? colors.muted : colors.primary }]}>
          {submitting
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <>
                <Ionicons name="send-outline" size={18} color={colors.primaryForeground} />
                <Text style={[styles.submitText, { color: colors.primaryForeground }]}>Send Enquiry</Text>
              </>
          }
        </TouchableOpacity>

        {/* Contact alternatives */}
        <View style={[styles.altContact, { borderColor: colors.border }]}>
          <Text style={[styles.altTitle, { color: colors.mutedForeground }]}>Or contact us directly</Text>
          <View style={styles.altRow}>
            <Ionicons name="mail-outline" size={15} color={colors.mutedForeground} />
            <Text style={[styles.altText, { color: colors.mutedForeground }]}>info@ucfilters.com</Text>
          </View>
          <View style={styles.altRow}>
            <Ionicons name="logo-whatsapp" size={15} color="#25D366" />
            <Text style={[styles.altText, { color: colors.mutedForeground }]}>0717774049</Text>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>
    </KeyboardAvoidingView>
  );
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize,
  multiline, numberOfLines, autoComplete, returnKeyType, onSubmitEditing, inputRef, colors,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  multiline?: boolean;
  numberOfLines?: number;
  autoComplete?: 'email' | 'name' | 'tel';
  returnKeyType?: 'next' | 'done';
  onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput | null>;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'words'}
        autoComplete={autoComplete}
        multiline={multiline}
        numberOfLines={numberOfLines}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={!multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '700' as const },
  scroll: { padding: 20, paddingBottom: 48, gap: 16 },
  productBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  productBadgeText: { fontSize: 14, fontWeight: '600' as const, maxWidth: 280 },
  intro: { fontSize: 14, lineHeight: 20 },
  fields: { gap: 14 },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 100, paddingTop: 12 },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: 10, padding: 12,
  },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 12, paddingVertical: 15,
  },
  submitText: { fontSize: 16, fontWeight: '700' as const },
  altContact: { borderTopWidth: 1, paddingTop: 16, gap: 8 },
  altTitle: { fontSize: 13, fontWeight: '600' as const },
  altRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  altText: { fontSize: 13 },
  // Success state
  successWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16,
  },
  successIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 24, fontWeight: '800' as const },
  successBody: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  doneBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, marginTop: 8 },
  doneBtnText: { fontSize: 16, fontWeight: '700' as const },
});
