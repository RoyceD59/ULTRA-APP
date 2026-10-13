import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import ProductPhoto from './ProductPhoto';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { headingProps } from '@/lib/accessibility';
import { fetchCollection, kes, type ProductRecord, type RecordCollection } from '@/lib/productRecord';
import { P } from './theme';

const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter(str) : []);
const firstSentence = (t: unknown) => (str(t) ? t.split('. ')[0].replace(/\.$/, '') + '.' : '');

export function useRecordCollection() {
  return useQuery<RecordCollection>({ queryKey: ['uc-product-records'], queryFn: ({ signal }) => fetchCollection(signal), staleTime: 600000 });
}

/** Collapsible layer: the whole header row is the toggle. */
export function Accordion({ title, icon, open: initial = false, children }: { title: string; icon?: keyof typeof Ionicons.glyphMap; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <View style={l.card}>
      <TouchableOpacity onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityLabel={`${title}, ${open ? 'collapse' : 'expand'}`}
        {...(Platform.OS === 'web' ? ({ 'aria-expanded': open } as object) : { accessibilityState: { expanded: open } })} style={l.accHead}>
        {icon ? <Ionicons name={icon} size={20} color={P.teal} /> : null}
        <Text {...headingProps(3)} style={l.accTitle}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={P.teal} />
      </TouchableOpacity>
      {open ? <View style={{ gap: 8, marginTop: 10 }}>{children}</View> : null}
    </View>
  );
}

export const Bullets = ({ items, ordered }: { items?: unknown; ordered?: boolean }) => {
  const xs = list(items);
  return xs.length ? <View style={{ gap: 4 }}>{xs.map((i, n) => <Text key={n} style={l.body}>{`${ordered ? `${n + 1}.` : '\u2022'} ${i}`}</Text>)}</View> : null;
};

export const H2 = ({ children }: { children: string }) => <Text {...headingProps(2)} style={l.h2}>{children}</Text>;

export function ReferenceEstimate({ record }: { record: ProductRecord }) {
  if (!record.savings) return null;
  return <View style={{ gap: 10, padding: 16, backgroundColor: P.aqua, borderRadius: 12 }}>
    <Text {...headingProps(3)} style={l.bF}>{record.savings.headline}</Text>
    <Bullets items={record.savings.detail} />
    <Text style={l.body}>{record.savings.assumption}</Text>
    <Text style={l.body}>Illustrative estimate, not guaranteed or measured personal savings.</Text>
  </View>;
}

export function SearchListing({ record }: { record: ProductRecord }) {
  if (!record.seo) return null;
  return <Accordion title="Search listing (from the record)">
    {str(record.seo.title) ? <Text style={l.body}>{`Page title: ${record.seo.title}`}</Text> : null}
    {str(record.seo.description) ? <Text style={l.body}>{`Description: ${record.seo.description}`}</Text> : null}
    {record.topics?.length ? <Text style={l.body}>{`Topic pages: ${record.topics.map(t => t.name).join(', ')}`}</Text> : null}
  </Accordion>;
}

/** Group tabs, then product tabs and a separate replacement-filter row, from the live collection. */
export function GroupNav({ record }: { record: ProductRecord }) {
  const router = useRouter();
  const { data } = useRecordCollection();
  const groups = data?.groups ?? [];
  if (!groups.length || !data) return null;
  const cur = groups.find(g => g.products.includes(record.code) || g.replacements.includes(record.code))
    ?? groups.find(g => g.id === record.navGroup);
  const byCode = new Map(data.products.map(p => [p.code, p]));
  const open = (code?: string) => { const p = code ? byCode.get(code) : undefined; if (p && p.code !== record.code) router.push(`/product/${p.slug}` as never); };
  const chip = (code: string) => {
    const p = byCode.get(code); if (!p) return null;
    const on = code === record.code;
    return <TouchableOpacity key={code} onPress={() => open(code)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[l.tab, on && l.tabOn]}>
      <Text style={[l.tabT, on && { color: P.ground }]}>{p.name}</Text></TouchableOpacity>;
  };
  return (
    <View style={{ gap: 8 }} accessibilityRole={'navigation' as never}>
      <View style={l.row}>
        {groups.map(g => { const on = g.id === cur?.id; const target = g.products.find(code => byCode.has(code)); return (
          <TouchableOpacity key={g.id} onPress={() => open(target)} disabled={!target} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !target }} style={[l.group, on && l.groupOn, !target && { opacity: 0.5 }]}>
            <Text style={[l.groupT, on && { color: P.navy }]}>{g.label}{target ? '' : ' — not published yet'}</Text></TouchableOpacity>); })}
      </View>
      {cur ? <View style={l.row}>
        {cur.products.map(chip)}
        {cur.replacements.length ? <><Text style={l.repL}>Replacement filters</Text>{cur.replacements.map(chip)}</> : null}
      </View> : null}
    </View>
  );
}

/** Layers between the buy panel and the selection summary, in the approved order. */
export function ProductLayers({ record, lifeSrc, lifeAlt, price }: { record: ProductRecord; lifeSrc?: string; lifeAlt?: string; price: number | null }) {
  const router = useRouter();
  const { data } = useRecordCollection();
  const b = record.benefits ?? {}; const s = record.suitability ?? {}; const k = record.package ?? {};
  const w = record.ownership ?? {}; const r = w.replacement ?? {}; const sv = record.service ?? {}; const o = record.opening ?? {};
  const items = Array.isArray(b.items) ? b.items.filter((i: any) => str(i?.feature)) : [];
  const products = data?.products ?? [];
  const rp = products.find(x => x.kind === 'replacement' && x.parentSku === r.sku && x.code !== record.code);
  const go = (slug: string) => router.push(`/product/${slug}` as never);
  const claims = record.claims ?? [];
  const limits = list(record.evidenceLimits);
  const suitRows: [string, string[]][] = [['Water', list(s.water)], ['Your setup', list(s.setup)], ['Not suitable', list(s.exclusions)]];

  return (
    <View style={{ gap: 14 }}>
      {items.length ? <View style={{ gap: 10 }}>
        <H2>{b.heading || 'Benefits'}</H2>
        <View style={l.grid}>
          {lifeSrc ? <View style={[l.life, l.cell]}><ProductPhoto src={lifeSrc} alt={lifeAlt ?? 'Product in use'} width={520} fit="cover" /></View> : null}
          <View style={[l.cell, { gap: 10 }]}>
            {items.map((i: any, n: number) => <View key={n} style={l.benefit}>
              <Ionicons name={(['water-outline', 'shield-checkmark-outline', 'refresh-outline'] as const)[n % 3]} size={22} color={P.teal} />
              <View style={{ flex: 1, gap: 2 }}><Text {...headingProps(3)} style={l.bF}>{i.feature}</Text>{str(i.consequence) ? <Text style={l.body}>{i.consequence}</Text> : null}</View>
            </View>)}
          </View>
        </View>
      </View> : null}

      {str(s.heading) ? <View style={l.check} nativeID="suit">
        <Text {...headingProps(3)} style={l.h3}>{s.heading}</Text>
        {str(s.intended_use) ? <Text style={l.note}>{s.intended_use}</Text> : null}
        {suitRows.filter(([, v]) => v.length).map(([t, v]) => <View key={t} style={l.spec}><Text style={l.specK}>{t}</Text><Text style={l.specV}>{v.join('; ')}</Text></View>)}
        {record.fitPhotos?.items?.length ? <View style={{ gap: 8, marginTop: 8 }}>
          <Text {...headingProps(3)} style={l.h3}>{record.fitPhotos.heading}</Text>
          <View style={l.grid}>{record.fitPhotos.items.map((f, i) => <View key={f.src + i} style={l.fitCard}>
            <View style={{ width: '100%', height: 180 }}><ProductPhoto src={f.src} alt={f.alt} width={320} /></View>
            {str(f.caption) ? <Text style={l.note}>{f.caption}</Text> : null}</View>)}</View>
        </View> : null}
      </View> : null}

      {claims.length || limits.length ? <Accordion title="What this filter does, and its limits" icon="bar-chart-outline" open>
        {claims.map((c, n) => <View key={n} style={{ gap: 2 }}>
          <Text style={[l.body, c.status === 'verified' && { fontWeight: '700' }]}>{`\u2022 ${c.text}`}</Text>
          <Text style={l.note}>{c.status === 'verified' && c.reports.length ? `Tested: ${c.reports.map(x => `${x.lab} ${x.report}`).join(', ')}` : c.status === 'verified' ? 'Report on record' : c.status === 'customer_reported' ? 'Customer-reported experience; not independently verified' : 'Manufacturer statement; not independently verified in this record'}{c.conditions ? `. ${c.conditions}` : ''}</Text>
        </View>)}
        {limits.length ? <Text style={l.body}><Text style={{ fontWeight: '700' }}>Limits. </Text>{limits.join(' ')}</Text> : null}
      </Accordion> : null}

      {list(k.included).length || list(k.setup_steps).length ? <Accordion title={k.heading || 'What is included'} icon="cube-outline">
        <Bullets items={k.included} />
        {list(k.sold_separately).length ? <Text style={l.body}>{`Sold separately: ${list(k.sold_separately).join(', ')}.`}</Text> : null}
        {str(k.dimensions) ? <Text style={l.note}>{`Dimensions: ${k.dimensions}`}</Text> : null}
        {list(k.setup_steps).length ? <><Text style={l.label}>Setup</Text><Bullets items={k.setup_steps} ordered /></> : null}
      </Accordion> : null}

      <H2>Know before you buy</H2>
      <ReferenceEstimate record={record} />
      <View style={l.grid}>
        <View style={[l.benefit, l.cell]}>
          <Ionicons name="refresh-outline" size={22} color={P.teal} />
          <View style={{ flex: 1, gap: 4 }}>
            {record.kind === 'replacement' ? <>
              <Text {...headingProps(3)} style={l.bF}>Fits</Text>
              <View style={l.row}>{(record.fits ?? []).map(n => { const t = products.find(x => x.name === n); return t
                ? <TouchableOpacity key={n} onPress={() => go(t.slug)} accessibilityRole="button"><Text style={l.link}>{n}</Text></TouchableOpacity>
                : <Text key={n} style={l.body}>{n}</Text>; })}</View>
              {str(r.guidance) ? <Text style={l.body}>{r.guidance}</Text> : null}
            </> : <>
              <Text {...headingProps(3)} style={l.bF}>Replacement and care</Text>
              <Text style={l.body}>{[str(r.name) ? r.name + (typeof r.price_kes === 'number' ? `: ${kes(r.price_kes)}.` : '.') : '', str(r.guidance) ? r.guidance : ''].filter(Boolean).join(' ') || 'No replacement part is listed for this product.'}</Text>
              {rp ? <TouchableOpacity onPress={() => go(rp.slug)} accessibilityRole="button"><Text style={l.link}>View replacement</Text></TouchableOpacity> : null}
            </>}
          </View>
        </View>
        <View style={[l.benefit, l.cell]}>
          <Ionicons name="car-outline" size={22} color={P.teal} />
          <View style={{ flex: 1, gap: 4 }}><Text {...headingProps(3)} style={l.bF}>Delivery and total cost</Text>
            <Text style={l.body}>{`${price !== null ? `${kes(price)} plus delivery. ` : ''}${o.delivery ?? sv.delivery ?? ''} Installation: ${str(w.installation) ? w.installation : 'none'}`}</Text></View>
        </View>
        <View style={[l.benefit, l.cell]}>
          <Ionicons name="headset-outline" size={22} color={P.teal} />
          <View style={{ flex: 1, gap: 4 }}><Text {...headingProps(3)} style={l.bF}>Support and returns</Text>
            <Text style={l.body}>{[str(sv.support) ? `${sv.support}.` : '', sv.warranty?.text, firstSentence(sv.returns)].filter(str).join(' ')}</Text>
            <Bullets items={sv.exclusions} /></View>
        </View>
      </View>
      <View style={[l.benefit, { alignItems: 'center' }]}>
        <Ionicons name="phone-portrait-outline" size={24} color={P.teal} />
        <View style={{ flex: 1 }}><Text {...headingProps(3)} style={l.bF}>Track your filter life</Text>
          <Text style={l.body}>Use this app to track your filter life and get support.</Text></View>
      </View>
    </View>
  );
}

export const serviceSummary = (rec: ProductRecord) => [rec.service?.warranty?.text, firstSentence(rec.service?.returns)].filter(str).join(' ');

const l = StyleSheet.create({
  card: { backgroundColor: P.ground, borderRadius: 16, borderWidth: 1, borderColor: P.line, padding: 14 },
  accHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  accTitle: { color: P.navy, fontSize: 18, fontWeight: '700', flex: 1 },
  h2: { color: P.navy, fontSize: 22, fontWeight: '800', marginTop: 10 },
  h3: { color: P.navy, fontSize: 18, fontWeight: '700' },
  body: { color: P.navy, fontSize: 15, lineHeight: 22 },
  note: { color: P.muted, fontSize: 13, lineHeight: 18 },
  label: { color: P.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  link: { color: P.teal, fontWeight: '700', fontSize: 15, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexGrow: 1, flexBasis: 280, minWidth: 0 },
  life: { minHeight: 260, borderRadius: 16, overflow: 'hidden', backgroundColor: P.aqua },
  benefit: { flexDirection: 'row', gap: 12, backgroundColor: P.aqua, borderRadius: 14, padding: 14, alignItems: 'flex-start' },
  bF: { color: P.navy, fontWeight: '700', fontSize: 16 },
  check: { backgroundColor: P.ground, borderRadius: 16, borderWidth: 1.5, borderColor: P.teal, padding: 14, gap: 6 },
  spec: { flexDirection: 'row', gap: 12, borderBottomWidth: 1, borderColor: P.line, paddingVertical: 8 },
  specK: { color: P.muted, fontSize: 14, fontWeight: '700', width: 104 },
  specV: { color: P.navy, fontSize: 14, flex: 1, lineHeight: 20 },
  fitCard: { flexGrow: 1, flexBasis: 240, minWidth: 0, backgroundColor: P.aqua, borderRadius: 12, padding: 8, gap: 6 },
  group: { paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
  groupOn: { borderColor: P.teal },
  groupT: { color: P.muted, fontWeight: '700', fontSize: 14 },
  tab: { borderWidth: 1, borderColor: P.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center', backgroundColor: P.ground },
  tabOn: { backgroundColor: P.navy, borderColor: P.navy },
  tabT: { color: P.navy, fontWeight: '600', fontSize: 14 },
  repL: { color: P.muted, fontSize: 13, paddingLeft: 10, borderLeftWidth: 1, borderColor: P.line },
});
