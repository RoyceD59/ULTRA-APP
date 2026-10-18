import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { Link } from 'expo-router';
import { isNewTab, linkifyText } from '@/lib/productLinks';
import { P } from './theme';

/**
 * Authored text where explicit http(s)/mailto/tel URLs become real anchors on web
 * (open-in-new-tab, copy, Enter) and Linking-backed links on native.
 */
export default function LinkedText({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const parts = linkifyText(children);
  if (!parts.some(p => p.href)) return <Text style={style}>{children}</Text>;
  return <Text style={style}>{parts.map((p, i) => p.href
    ? <Link key={i} href={p.href as never} target={isNewTab(p.href) ? '_blank' : undefined} rel={isNewTab(p.href) ? 'noopener noreferrer' : undefined}
        accessibilityRole="link" style={{ color: P.tealDark, textDecorationLine: 'underline', fontWeight: '600' }}>{p.text}</Link>
    : <React.Fragment key={i}>{p.text}</React.Fragment>)}</Text>;
}
