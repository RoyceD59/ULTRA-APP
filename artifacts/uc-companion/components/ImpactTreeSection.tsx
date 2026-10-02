/**
 * Hydrate the Future™ tree — the tree section of the Impact Card.
 *
 * Funding comes from the customer's own paid orders (3% each); refills only
 * animate the tree. Field planting/establishment is programme-reported and is
 * never inferred here. See lib/impactTree.ts for the rules.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, Linking, Modal,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import { customerQueryKeys } from '@/lib/customerQueryKeys';
import {
  TREE_CONFIG, TREE_STAGES, TREE_ID_PATTERN, computeTreeProgress, forestLink, newTreeId,
  type TreeStage,
} from '@/lib/impactTree';

/** Hosted copy of forest/forest.html. The CTA is hidden until this is set. */
const FOREST_URL = process.env.EXPO_PUBLIC_FOREST_URL;

const LEAF = '#2E8B57';
const LEAF_DARK = '#1F6B43';
const TRUNK = '#8B5E3C';
const SOIL = '#7A5A3A';

const kes = (n: number) => `KSh ${Math.round(n).toLocaleString('en-US')}`;

interface Props {
  /** Number of refill entries already logged on the card. */
  refillEntries: number;
}

export default function ImpactTreeSection({ refillEntries }: Props) {
  const colors = useColors();
  const api = useApi();
  const { user } = useAuth();
  const [methodOpen, setMethodOpen] = useState(false);
  const [treeId, setTreeId] = useState<string | null>(null);

  const ordersQ = useQuery({
    queryKey: customerQueryKeys.orders(user?.id),
    queryFn: () => api.getOrders(),
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });

  // Anonymous, per-account tree id kept on this device.
  useEffect(() => {
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
        if (!cancelled) setTreeId(id);
      } catch { /* link simply stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const progress = computeTreeProgress(ordersQ.data ?? [], refillEntries);
  const stageInfo = TREE_STAGES[progress.stage];

  // ── Animation: grow on stage change, gentle sway, pulse when watered ────
  const grow = useRef(new Animated.Value(0.85)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const water = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const lastRefills = useRef(refillEntries);
  const [watered, setWatered] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  useEffect(() => {
    if (reduceMotion) { grow.setValue(1); return; }
    grow.setValue(0.85);
    Animated.spring(grow, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [progress.stage, reduceMotion, grow]);

  useEffect(() => {
    if (reduceMotion || progress.stage === 'none') return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [progress.stage, reduceMotion, sway]);

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

  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ['-1.5deg', '1.5deg'] });

  const barPct = progress.stage === 'funded' ? progress.currentTreePct : Math.min(99, progress.totalPctOfTree);
  const link = FOREST_URL && treeId ? safeForestLink(FOREST_URL, treeId, progress.stage) : null;

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.background }]} testID="impact-tree">
      <View style={styles.headRow}>
        <Text style={[styles.title, { color: colors.text }]}>Your Hydrate the Future™ tree</Text>
        <TouchableOpacity onPress={() => setMethodOpen(true)} accessibilityLabel="How your tree is calculated" hitSlop={8}>
          <Ionicons name="information-circle-outline" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {ordersQ.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
      ) : ordersQ.isError ? (
        <View style={{ gap: 8, alignItems: 'flex-start' }}>
          <Text style={[styles.small, { color: colors.mutedForeground }]}>We couldn’t load your purchases to grow your tree.</Text>
          <TouchableOpacity onPress={() => ordersQ.refetch()}>
            <Text style={[styles.link, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.treeRow}>
            <View style={styles.treeBox} accessible accessibilityLabel={`Tree stage: ${stageInfo.label}`}>
              <Animated.View style={{ transform: [{ scale: grow }, { rotate }] }}>
                <TreeArt stage={progress.stage} />
              </Animated.View>
              <Animated.View pointerEvents="none" style={[styles.drop, { opacity: water }]}>
                <Ionicons name="water" size={18} color="#27B7D7" />
              </Animated.View>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.stage, { color: LEAF_DARK }]}>
                {progress.stage === 'funded' && progress.treesFunded > 1
                  ? `${progress.treesFunded} funded trees`
                  : stageInfo.label}
              </Text>
              <Text style={[styles.small, { color: colors.mutedForeground }]}>{stageInfo.meaning}</Text>
              {watered && (
                <Text style={[styles.small, { color: '#0A77A8' }]}>Your refill watered your tree.</Text>
              )}
            </View>
          </View>

          {progress.stage !== 'none' && (
            <>
              <View style={styles.statsRow}>
                <Stat label="Eligible purchases" value={kes(progress.eligiblePurchasesKes)} />
                <Stat label="Your 3% allocation" value={kes(progress.allocationKes)} />
              </View>

              <View style={{ gap: 4 }}>
                <View style={styles.barHead}>
                  <Text style={[styles.small, { color: colors.text, fontWeight: '700' }]}>
                    {progress.treesFunded >= 1 ? 'Next tree funded' : 'Estimated tree cost funded'}
                  </Text>
                  <Text style={[styles.small, { color: colors.text, fontWeight: '700' }]}>{barPct}%</Text>
                </View>
                <View style={[styles.track, { backgroundColor: colors.border }]}
                  accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: barPct }}>
                  <View style={[styles.fill, { width: `${barPct}%` }]} />
                </View>
                <Text style={[styles.tiny, { color: colors.mutedForeground }]}>
                  Of an estimated {kes(TREE_CONFIG.treeCostKes)} per tree (conservative end of KSh 500–750)
                </Text>
              </View>

              <Text style={[styles.small, { color: colors.mutedForeground }]}>
                {progress.replacementPurchases} replacement{progress.replacementPurchases === 1 ? '' : 's'} · {progress.refillEntries} refill{progress.refillEntries === 1 ? '' : 's'} logged
              </Text>
            </>
          )}

          <Text style={[styles.tiny, { color: colors.mutedForeground }]}>
            Your purchases nurture this digital tree. Field planting and establishment are reported separately as programme activity.
          </Text>

          {link && (
            <TouchableOpacity onPress={() => Linking.openURL(link).catch(() => {})} style={styles.cta} testID="impact-tree-forest">
              <Ionicons name="leaf" size={16} color="#fff" />
              <Text style={styles.ctaText}>See your tree in our growing forest</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <Modal visible={methodOpen} transparent animationType="fade" onRequestClose={() => setMethodOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.headRow}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>How your tree grows</Text>
              <TouchableOpacity onPress={() => setMethodOpen(false)} accessibilityLabel="Close"><Ionicons name="close" size={22} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10 }}>
              <Method title="Allocation" body="3% of each eligible purchase — paid KES orders that were not cancelled, failed or refunded — is allocated to Hydrate the Future™ tree growing and restoration in Kenya." />
              <Method title="Tree cost" body={`Progress uses KSh ${TREE_CONFIG.treeCostKes} per tree, the conservative end of the KSh ${TREE_CONFIG.treeCostRangeKes[0]}–${TREE_CONFIG.treeCostRangeKes[1]} Kenya estimate, so impact is never overstated. International programme estimates (USD 2.15–3.75) are separate and are not used here.`} />
              <Method title="Interim benchmark" body={`At the interim average of KSh ${TREE_CONFIG.interimAverageLtvKes.toLocaleString('en-US')} per sale (a proxy, not confirmed customer LTV), 3% is about KSh 367 — roughly half of one tree. One customer funds a whole tree at about KSh 25,000 of purchases; below that, several customers’ contributions combine.`} />
              <Method title="Refills" body="Refills you log water your tree and move it to Sprout. They are not purchases, so they don’t add funding." />
              <Method title="Funded vs established" body="“Funded” means your allocation has reached the estimated cost of a tree. “Established” is a separate status that only the programme can confirm from field verification." />
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

/** Stage artwork — a simple layered SVG that grows with each stage. */
function TreeArt({ stage }: { stage: TreeStage }) {
  return (
    <Svg width={96} height={96} viewBox="0 0 96 96">
      <Ellipse cx={48} cy={88} rx={34} ry={6} fill={SOIL} opacity={0.35} />
      {stage === 'none' && <Ellipse cx={48} cy={84} rx={10} ry={3} fill={SOIL} opacity={0.6} />}
      {stage === 'seed' && <Ellipse cx={48} cy={82} rx={6} ry={4.5} fill={TRUNK} />}
      {stage === 'sprout' && (
        <>
          <Rect x={46.5} y={66} width={3} height={18} rx={1.5} fill={LEAF_DARK} />
          <Path d="M48 70 C 38 64, 36 58, 40 54 C 46 58, 48 64, 48 70 Z" fill={LEAF} />
          <Path d="M48 68 C 58 62, 60 56, 56 52 C 50 56, 48 62, 48 68 Z" fill={LEAF} />
        </>
      )}
      {stage === 'sapling' && (
        <>
          <Rect x={46} y={52} width={4} height={33} rx={2} fill={TRUNK} />
          <Circle cx={48} cy={48} r={14} fill={LEAF} />
          <Circle cx={40} cy={54} r={8} fill={LEAF_DARK} opacity={0.8} />
        </>
      )}
      {stage === 'growing' && (
        <>
          <Rect x={45} y={44} width={6} height={41} rx={3} fill={TRUNK} />
          <Circle cx={48} cy={38} r={20} fill={LEAF} />
          <Circle cx={34} cy={48} r={11} fill={LEAF_DARK} opacity={0.85} />
          <Circle cx={62} cy={46} r={12} fill={LEAF_DARK} opacity={0.85} />
        </>
      )}
      {stage === 'funded' && (
        <>
          <Rect x={44} y={40} width={8} height={45} rx={3} fill={TRUNK} />
          <Circle cx={48} cy={30} r={24} fill={LEAF} />
          <Circle cx={30} cy={44} r={14} fill={LEAF_DARK} opacity={0.9} />
          <Circle cx={66} cy={42} r={15} fill={LEAF_DARK} opacity={0.9} />
          <Circle cx={56} cy={22} r={4} fill="#F2C94C" />
        </>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap:       { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  headRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title:      { fontSize: 13, fontWeight: '700', flex: 1 },
  treeRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  treeBox:    { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  drop:       { position: 'absolute', top: 4, right: 10 },
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
