/**
 * Hydrate the Future™ tree — the tree section of the Impact Card.
 *
 * Shows a copy of the customer's shared tree from GET /api/uc/customer/tree:
 * half of their 3% allocation grows trees, several customers fill one tree,
 * and only their own share is shown. Refills only animate the tree. Field
 * establishment is programme-reported. See lib/impactTree.ts.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, Linking, Modal,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import TreeScene from '@/components/TreeScene';
import ForestLink from '@/components/ForestLink';
import { useLiveSky } from '@/hooks/useLiveSky';
import {
  FOREST_URL, TREE_CONFIG, TREE_STAGES, TREE_ID_PATTERN, displayStage, forestLink, newTreeId,
  type TreeStage,
} from '@/lib/impactTree';

const LEAF = '#2E8B57';
const LEAF_DARK = '#1F6B43';

const kes = (n: number) => `KSh ${Math.round(n).toLocaleString('en-US')}`;

interface Props {
  /** Number of refill entries already logged on the card. */
  refillEntries: number;
}

export default function ImpactTreeSection({ refillEntries }: Props) {
  const { user } = useAuth();
  // Unmount all account-local identity, animation and error state on a switch.
  return <AccountImpactTree key={user?.id ?? 'guest'} refillEntries={refillEntries} />;
}

function AccountImpactTree({ refillEntries }: Props) {
  const colors = useColors();
  const api = useApi();
  const { user, token } = useAuth();
  const [methodOpen, setMethodOpen] = useState(false);
  const sky = useLiveSky();
  const [identity, setIdentity] = useState<{ accountId: number; treeId: string } | null>(null);
  const [linkError, setLinkError] = useState('');

  const treeQ = useQuery({
    queryKey: ['customer', user?.id, 'hydrate-tree'],
    queryFn: () => api.getCustomerTree(),
    enabled: !!user && !!token,
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
  });

  // Anonymous, per-account tree id kept on this device.
  useEffect(() => {
    setLinkError('');
    if (!user) return;
    const key = `uc_hydrate_tree_id_${user.id}`;
    let cancelled = false;
    (async () => {
      try {
        let id = await AsyncStorage.getItem(key);
        if (!id || !TREE_ID_PATTERN.test(id)) {
          id = newTreeId(n => Crypto.getRandomBytes(n));
          await AsyncStorage.setItem(key, id);
        }
        if (!cancelled) setIdentity({ accountId: user.id, treeId: id });
      } catch { /* link simply stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const data = treeQ.data;
  const stage = displayStage(data, refillEntries);
  const stageInfo = TREE_STAGES[stage];

  // ── Animation: grow on stage change, gentle sway, pulse when watered ────
  const grow = useRef(new Animated.Value(0.94)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const water = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const lastRefills = useRef(refillEntries);
  const [watered, setWatered] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) { grow.setValue(1); return; }
    grow.setValue(0.94);
    Animated.spring(grow, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [stage, reduceMotion, grow]);

  useEffect(() => {
    if (reduceMotion || stage === 'none') { sway.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [stage, reduceMotion, sway]);

  useEffect(() => {
    if (refillEntries > lastRefills.current) {
      setWatered(true);
      if (!reduceMotion) {
        water.setValue(1);
        Animated.timing(water, { toValue: 0, duration: 1600, useNativeDriver: true }).start();
      }
      const t = setTimeout(() => setWatered(false), 4000);
      lastRefills.current = refillEntries;
      return () => clearTimeout(t);
    }
    lastRefills.current = refillEntries;
  }, [refillEntries, reduceMotion, water]);

  // Real wind sets the sway: a still evening barely moves, a gusty storm bends.
  const swayDeg = Math.min(3, 0.4 + sky.weather.windKmh / 18);
  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: [`-${swayDeg}deg`, `${swayDeg}deg`] });

  const barPct = data?.tree?.fundedPct ?? 0;
  const treeId = identity?.accountId === user?.id ? identity?.treeId : null;
  const link = FOREST_URL && treeId && stage !== 'none' && !treeQ.isError
    ? safeForestLink(FOREST_URL, treeId, stage) : null;

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.background }]} testID="impact-tree">
      <View style={styles.headRow}>
        <Text style={[styles.title, { color: colors.text }]}>Your Hydrate the Future™ tree</Text>
        <TouchableOpacity onPress={() => setMethodOpen(true)} accessibilityLabel="How your tree is calculated" hitSlop={8}>
          <Ionicons name="information-circle-outline" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {treeQ.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
      ) : treeQ.isError ? (
        <View style={{ gap: 8, alignItems: 'flex-start' }}>
          <Text style={[styles.small, { color: colors.mutedForeground }]}>We couldn’t load your tree right now.</Text>
          <TouchableOpacity onPress={() => treeQ.refetch()}>
            <Text style={[styles.link, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View accessible accessibilityRole="image"
            accessibilityLabel={`Illustration of your shared tree at the ${stageInfo.label} stage`}>
            <TreeScene stage={stage} palette={sky.palette} weather={sky.weather}
              treeStyle={{ transform: [{ scale: grow }, { rotate }] }} />
            <Animated.View pointerEvents="none" style={[styles.drop, { opacity: water }]}>
              <Ionicons name="water" size={18} color="#27B7D7" />
            </Animated.View>
          </View>
          <Text style={[styles.tiny, { color: colors.mutedForeground }]} testID="impact-tree-sky">
            {sky.summary}
          </Text>
          <View style={styles.treeRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.stage, { color: LEAF_DARK }]}>{stageInfo.label}</Text>
              <Text style={[styles.small, { color: colors.mutedForeground }]}>{stageInfo.meaning}</Text>
              {watered && (
                <Text style={[styles.small, { color: '#0A77A8' }]}>Your refill watered your tree.</Text>
              )}
            </View>
          </View>

          {data && stage !== 'none' && (
            <>
              <View style={styles.statsRow}>
                <Stat label="Eligible purchases" value={kes(data.eligiblePurchasesKes)} />
                <Stat label="Your 3% allocation" value={kes(data.allocationKes)} />
              </View>
              <Text style={[styles.small, { color: colors.mutedForeground }]}>
                {kes(data.treeShareKes)} grows trees · {kes(data.cleanWaterKes)} supports clean-water access
              </Text>

              {data.tree && (
                <View style={{ gap: 4 }}>
                  <View style={styles.barHead}>
                    <Text style={[styles.small, { color: colors.text, fontWeight: '700' }]}>Your shared tree funded</Text>
                    <Text style={[styles.small, { color: colors.text, fontWeight: '700' }]}>{barPct}%</Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: colors.border }]}
                    accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: barPct }}>
                    <View style={[styles.fill, { width: `${barPct}%` }]} />
                  </View>
                  <Text style={[styles.tiny, { color: colors.mutedForeground }]}>
                    You added {kes(data.tree.yourShareKes)} to this tree, estimated at {kes(data.config.treeCostKes)}. Customers’ contributions combine to grow each tree.
                  </Text>
                </View>
              )}

              <Text style={[styles.small, { color: colors.mutedForeground }]}>
                {data.treesHelped > 1 ? `${data.treesHelped} trees helped · ` : ''}{data.replacementPurchases} replacement{data.replacementPurchases === 1 ? '' : 's'} · {refillEntries} refill{refillEntries === 1 ? '' : 's'} logged
              </Text>
            </>
          )}

          <Text style={[styles.tiny, { color: colors.mutedForeground }]}>
            Your purchases nurture this digital tree. Field planting and establishment are reported separately as programme activity.
          </Text>

          {link && (
            <TouchableOpacity accessibilityRole="link" onPress={() => {
              setLinkError('');
              Linking.openURL(link).catch(() => setLinkError('Unable to open the forest. Please try again.'));
            }} style={styles.cta} testID="impact-tree-forest">
              <Ionicons name="leaf" size={16} color="#fff" />
              <Text style={styles.ctaText}>See your tree in our growing forest</Text>
            </TouchableOpacity>
          )}
          {!!linkError && <Text accessibilityRole="alert" style={[styles.small, { color: colors.destructive }]}>{linkError}</Text>}
        </>
      )}

      {!link && <ForestLink label="Browse the global forest" testID="impact-tree-public-forest" />}

      <Modal visible={methodOpen} transparent animationType="fade" onRequestClose={() => setMethodOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.headRow}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>How your tree grows</Text>
              <TouchableOpacity onPress={() => setMethodOpen(false)} accessibilityLabel="Close"><Ionicons name="close" size={22} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10 }}>
              <Method title="Allocation" body="3% of each eligible purchase (paid KES orders that were not cancelled, failed or refunded) goes to Hydrate the Future™. Half grows trees in Kenya; the other half supports clean-water access." />
              <Method title="Shared trees" body="Tree contributions from several customers combine to fund one tree, filled in purchase order. You see your tree’s progress and your own share. Other customers’ details are never shown." />
              <Method title="Tree cost" body={`Each new tree is estimated at KSh ${data?.config.treeCostKes ?? TREE_CONFIG.treeCostKes}. The Kenya estimate is KSh ${TREE_CONFIG.treeCostRangeKes[0]}–${TREE_CONFIG.treeCostRangeKes[1]}. International programme estimates (USD 2.15–3.75) are separate and not used here.`} />
              <Method title="Customer lifetime value" body="Confirmed customer lifetime value and programme field results are not yet available. Your purchase allocation is not a donation receipt, a carbon credit or verified field impact." />
              <Method title="Refills" body="Refills you log water your tree and can move a seed to Sprout. They are not purchases, so they don’t add funding." />
              <Method title="Funded vs established" body="“Funded” means contributions have reached the tree’s estimated cost. “Established” is shown only when the programme confirms the tree in the field." />
            </ScrollView>
            <TouchableOpacity onPress={() => setMethodOpen(false)} style={[styles.cta, { marginTop: 8 }]}>
              <Text style={styles.ctaText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function safeForestLink(base: string, id: string, stage: TreeStage): string | null {
  try { return forestLink(base, id, stage); } catch { return null; }
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={[styles.stat, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.tiny, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function Method({ title, body }: { title: string; body: string }) {
  const colors = useColors();
  return (
    <View style={[styles.method, { backgroundColor: colors.background }]}>
      <Text style={[styles.small, { color: colors.text, fontWeight: '700' }]}>{title}</Text>
      <Text style={[styles.small, { color: colors.mutedForeground }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:       { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  headRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title:      { fontSize: 13, fontWeight: '700', flex: 1 },
  treeRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  drop:       { position: 'absolute', top: '42%', left: '54%' },
  stage:      { fontSize: 16, fontWeight: '800' },
  statsRow:   { flexDirection: 'row', gap: 8 },
  stat:       { flex: 1, borderWidth: 1, borderRadius: 10, padding: 8, gap: 2 },
  statValue:  { fontSize: 15, fontWeight: '700' },
  barHead:    { flexDirection: 'row', justifyContent: 'space-between' },
  track:      { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill:       { height: '100%', borderRadius: 3, backgroundColor: LEAF },
  small:      { fontSize: 12, lineHeight: 17 },
  tiny:       { fontSize: 11, lineHeight: 15 },
  link:       { fontSize: 13, fontWeight: '700' },
  cta:        { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: LEAF_DARK, borderRadius: 10, minHeight: 44, paddingHorizontal: 12 },
  ctaText:    { color: '#fff', fontSize: 14, fontWeight: '700' },
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modal:      { borderWidth: 1, borderRadius: 16, padding: 18, gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  method:     { borderRadius: 10, padding: 10, gap: 2 },
});
