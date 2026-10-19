import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { SavedPayLink } from '@/hooks/useApi';
import { trackProductEvent } from '@/lib/productAnalytics';

export function savedOrderMessage(link: SavedPayLink, method: 'copy' | 'whatsapp') {
  const items = link.summary.items.map(i =>
    `${i.name}${i.size ? ` ${i.size}` : ''}${i.variant ? `, ${i.variant}` : ''} (${i.sku}) × ${i.quantity}`).join('; ');
  const url = new URL(link.url);
  url.searchParams.set('utm_source', 'share');
  url.searchParams.set('utm_medium', method);
  return `Please pay for my Ultra Clear order: ${items}, KES ${link.summary.total.toLocaleString('en-KE')} including delivery. Review and pay here: ${url}`;
}
export default function SavedOrderSharing({ link, onRevoke }: { link: SavedPayLink; onRevoke: () => void }) {
  const [feedback, setFeedback] = useState('');
  async function share(method: 'copy' | 'whatsapp') {
    try {
      const text = savedOrderMessage(link, method);
      if (method === 'copy') { await Clipboard.setStringAsync(text); setFeedback('Message copied.'); }
      else { await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`); setFeedback('WhatsApp opened.'); }
      trackProductEvent('share', { method, itemCount: link.summary.items.reduce((n, i) => n + i.quantity, 0) });
    } catch { setFeedback('Sharing failed. Your saved order is unchanged; try again.'); }
  }
  return <View style={{ gap: 12, padding: 20, backgroundColor: '#e9f6f7', borderRadius: 14 }}>
    <Text style={{ fontWeight: '700', fontSize: 20, color: '#005d8f' }}>Order #{link.orderId} — awaiting payment</Text>
    <Text>Your order is saved, not paid or confirmed for fulfillment. Total: KES {link.summary.total.toLocaleString('en-KE')} including its calculated delivery.</Text>
    <Text>This bearer link allows anyone you send it to to pay this exact order. Share it intentionally. Your full address, email and phone are not shown.</Text>
    <Text>Expires: {new Date(link.expiresAt).toLocaleString()}</Text>
    {(['whatsapp', 'copy'] as const).map(method => <TouchableOpacity key={method} accessibilityRole="button"
      onPress={() => void share(method)} style={{ padding: 14, borderRadius: 10, backgroundColor: '#005d8f' }}>
      <Text style={{ color: '#fff', fontWeight: '700' }}>{method === 'whatsapp' ? 'Share with WhatsApp' : 'Copy plain-text message'}</Text>
    </TouchableOpacity>)}
    <TouchableOpacity accessibilityRole="button" onPress={onRevoke} style={{ padding: 14 }}>
      <Text style={{ color: '#005d8f', fontWeight: '700' }}>Revoke link and refresh checkout</Text>
    </TouchableOpacity>
    {!!feedback && <Text accessibilityLiveRegion="polite">{feedback}</Text>}
  </View>;
}
