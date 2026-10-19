import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { COD_PAYMENT_DETAILS, type CustomerReceipt } from '@workspace/api-zod/order-receipt';

interface Props {
  receipt: CustomerReceipt;
  onSave: () => void;
  onShare: () => void;
  onWhatsApp: () => void;
  busy: boolean;
}

export default function OrderReceiptCard({ receipt, onSave, onShare, onWhatsApp, busy }: Props) {
  const c = useColors();

  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <View style={s.row}>
      <Text style={[s.label, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[s.value, { color: strong ? c.primary : c.text }, strong && s.strong]}>{value}</Text>
    </View>
  );

  const Action = ({ label, hint, onPress, primary }: { label: string; hint: string; onPress: () => void; primary?: boolean }) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={[s.btn, primary
        ? { backgroundColor: c.primary }
        : { backgroundColor: c.primaryLight, borderColor: c.primary, borderWidth: 1 }, busy && { opacity: 0.6 }]}>
      {busy && primary ? <ActivityIndicator size="small" color="#fff" /> : (
        <Text style={[s.btnText, { color: primary ? '#fff' : c.primary }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={s.wrap}>
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]} accessibilityLabel={`Order receipt ${receipt.serial}`}>
        <View style={[s.header, { backgroundColor: c.primary }]}>
          <Text style={s.brand}>ULTRA CLEAR FILTERS</Text>
          <Text style={s.title}>Order receipt</Text>
          <Text selectable style={s.serial}>{receipt.serial}</Text>
        </View>

        <View style={s.body}>
          <Row label="Order" value={`#${receipt.orderNumber}`} />
          <Row label="Date" value={receipt.date} />
          {receipt.customerName ? <Row label="Customer" value={receipt.customerName} /> : null}
          <Row label="Payment" value={receipt.paymentMethod} />
          <Row label="Payment status" value={receipt.paymentState} />
          {receipt.paymentReference ? <Row label="Payment reference" value={receipt.paymentReference} /> : null}

          <View style={[s.rule, { backgroundColor: c.border }]} />
          <Text style={[s.section, { color: c.text }]}>Items ordered</Text>
          {receipt.items.length === 0 ? (
            <Text style={[s.value, { color: c.mutedForeground }]}>No items listed</Text>
          ) : receipt.items.map((item, i) => (
            <View key={i} style={[s.item, { borderBottomColor: c.border }]}>
              <Text style={[s.itemName, { color: c.text }]}>{item.name}</Text>
              <View style={s.row}>
                <Text style={[s.label, { color: c.mutedForeground }]}>Quantity: {item.quantity}</Text>
                <Text style={[s.value, { color: c.text }]}>{item.total}</Text>
              </View>
            </View>
          ))}

          {receipt.discount ? (
            <Row label={`Discount${receipt.promoCode ? ` (${receipt.promoCode})` : ''}`} value={`-${receipt.discount}`} />
          ) : null}
          {receipt.shipping ? <Row label="Delivery" value={receipt.shipping} /> : null}
          <View style={[s.totalBox, { borderTopColor: c.primary }]}>
            <Row label="Total" value={receipt.total} strong />
          </View>

          <View style={[s.rule, { backgroundColor: c.border }]} />
          <Text style={[s.section, { color: c.text }]}>{receipt.fulfillment}</Text>
          <Text selectable style={[s.value, s.left, { color: c.text }]}>{receipt.address}</Text>

          {receipt.codPaymentDue ? (
            <View style={[s.note, { backgroundColor: c.primaryLight, borderColor: c.primary }]} accessibilityRole="alert">
              <Text style={[s.noteTitle, { color: c.text }]}>Payment due on delivery</Text>
              <Text style={[s.noteBody, { color: c.text }]}>
                Cash on Delivery means payment is still due. This receipt is not proof of payment.
              </Text>
              <Text selectable style={[s.noteBody, { color: c.text }]}>M-Pesa Till: {COD_PAYMENT_DETAILS.mpesaTill}</Text>
              <Text selectable style={[s.noteBody, { color: c.text }]}>Paybill: {COD_PAYMENT_DETAILS.paybill}</Text>
              <Text selectable style={[s.noteBody, { color: c.text }]}>Account: {COD_PAYMENT_DETAILS.paybillAccount}</Text>
            </View>
          ) : null}

          <Text style={[s.foot, { color: c.mutedForeground }]}>
            Quote your receipt number when contacting us. Call {COD_PAYMENT_DETAILS.phone} or email support@ucfilters.co.ke
          </Text>
        </View>
      </View>

      <Text style={[s.hint, { color: c.mutedForeground }]}>
        Tip: take a screenshot of this receipt to keep a private copy of your order.
      </Text>
      <Text style={[s.hint, { color: c.mutedForeground }]}>
        {Platform.OS === 'web'
          ? 'Save PDF opens a print preview. Choose Save as PDF. Sharing includes your order and delivery details.'
          : 'Save PDF opens your phone’s sharing menu. Choose Save to Files or WhatsApp. Sharing includes your delivery details.'}
      </Text>

      <View style={s.actions}>
        <Action label="Save PDF" hint="Opens the receipt saving options" onPress={onSave} primary />
        <Action label="Share receipt" hint="Shares this receipt" onPress={onShare} />
        <Action label="WhatsApp" hint="Opens WhatsApp with a receipt summary; choose a recipient before sending" onPress={onWhatsApp} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 14 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  header: { padding: 18, gap: 4 },
  brand: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  serial: { color: '#fff', fontSize: 14, fontWeight: '600' },
  body: { padding: 16, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  label: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  value: { fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  left: { textAlign: 'left', fontWeight: '400' },
  strong: { fontSize: 18, fontWeight: '800' },
  rule: { height: 1, marginVertical: 6 },
  section: { fontSize: 16, fontWeight: '700' },
  item: { borderBottomWidth: 1, paddingVertical: 8, gap: 2 },
  itemName: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  totalBox: { borderTopWidth: 2, paddingTop: 8, marginTop: 4 },
  note: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 10, padding: 12, gap: 4, marginTop: 8 },
  noteTitle: { fontSize: 15, fontWeight: '800' },
  noteBody: { fontSize: 14, lineHeight: 20 },
  foot: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  hint: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  btn: { flexGrow: 1, flexBasis: 150, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { fontSize: 15, fontWeight: '700' },
});
