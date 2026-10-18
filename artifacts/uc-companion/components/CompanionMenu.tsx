import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPANION_TABS } from '@/lib/companionLayout';

const EXTRA = [
  { label: 'Cart', icon: 'bag-outline', href: '/cart' },
  { label: 'About us', icon: 'information-circle-outline', href: '/about' },
] as const;

/** Own hooks here, not below the parent navigator's authentication early returns. */
export function CompanionTabMenu() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const onTab = COMPANION_TABS.some(t => t.href === '/' ? pathname === '/' : pathname === t.href || pathname.startsWith(`${t.href}/`));
  return onTab ? <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, right: 8, zIndex: 30 }}>
    <View style={{ backgroundColor: '#FBFDFE', borderRadius: 22, borderWidth: 1, borderColor: '#CFE6E8' }}><CompanionMenu /></View>
  </View> : null;
}

/** Accessible menu toggle. Destinations are real links (web hrefs) and native routes. */
export default function CompanionMenu({ tint = '#0054A6' }: { tint?: string }) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const toggleRef = useRef<View>(null);

  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    if (open || Platform.OS !== 'web') return;
    (toggleRef.current as unknown as HTMLElement | null)?.focus?.();
  }, [open]);

  const items = [...COMPANION_TABS.map(t => ({ label: t.label, icon: t.icon, href: t.href })), ...EXTRA];
  return <>
    <TouchableOpacity ref={toggleRef} onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityLabel={open ? 'Close menu' : 'Open menu'}
      accessibilityState={{ expanded: open }} aria-expanded={open} aria-haspopup="menu" testID="companion-menu-toggle" style={s.toggle}>
      <Ionicons name={open ? 'close' : 'menu'} size={22} color={tint} />
    </TouchableOpacity>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={s.scrim} onPress={() => setOpen(false)} accessibilityLabel="Close menu" />
      <View style={[s.panel, { top: insets.top + 8, maxHeight: Math.max(120, height - insets.top - 16) }]} accessibilityLabel="Site menu" testID="companion-menu">
        <View style={s.head}>
          <Text style={s.title}>Menu</Text>
          <TouchableOpacity onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close menu" style={s.toggle}>
            <Ionicons name="close" size={22} color={tint} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flexShrink: 1 }}>
        {items.map(item => (
          <Link key={item.href} href={item.href as never} onPress={() => setOpen(false)} accessibilityRole="link" style={s.item}>
            <Ionicons name={item.icon as never} size={20} color={tint} />
            <Text style={s.itemT}>{` ${item.label}`}</Text>
          </Link>
        ))}
        </ScrollView>
      </View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  toggle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  scrim: { ...StyleSheet.absoluteFill as object, backgroundColor: 'rgba(11,37,69,0.35)' },
  panel: { position: 'absolute', right: 8, width: 260, maxWidth: '92%' as never, backgroundColor: '#FBFDFE', borderRadius: 16, padding: 8, borderWidth: 1, borderColor: '#CFE6E8' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12 },
  title: { color: '#0B2545', fontSize: 16, fontWeight: '700' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 12, borderRadius: 10 },
  itemT: { color: '#0B2545', fontSize: 16, fontWeight: '600' },
});
