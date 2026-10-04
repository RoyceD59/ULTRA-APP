import { headingProps } from '@/lib/accessibility';
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, LayoutAnimation, UIManager, TextInput, Linking, Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/hooks/useColors';
import { GUIDES, GuideSection } from '@/data/guides';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useQuery } from '@tanstack/react-query';
import { fetchPublishedGuide } from '@/lib/guideContent';
import { resolveMediaUrl } from '@/hooks/useApi';
import { trackEvent } from '@/lib/analytics';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const topPad = Platform.OS === 'web' ? 67 : 0;
const SUPPORT_PHONE = '0717774049';
const SUPPORT_TEL   = 'tel:+254717774049';

// ── Icon map ──────────────────────────────────────────────────────────────────
const HEADING_ICON_MAP: Array<[RegExp, string]> = [
  [/box|unbox|in the box|package|what.s include/i, 'cube-outline'],
  [/tool|equipment|require|need/i,                  'construct-outline'],
  [/install|fit|attach|connect|mount|setup|set up/i,'hammer-outline'],
  [/clean|wash|hygiene|disinfect/i,                 'sparkles-outline'],
  [/storage|store|shelf|keep/i,                     'archive-outline'],
  [/replac|swap|change|cartridge/i,                 'refresh-outline'],
  [/first use|before|priming|prime/i,               'hand-left-outline'],
  [/daily|every day|routine|use/i,                  'sunny-outline'],
  [/troubleshoot|problem|issue|fix|not work/i,      'build-outline'],
  [/tip|trick|best practice|advice/i,               'bulb-outline'],
  [/warning|caution|danger|avoid/i,                 'warning-outline'],
  [/switch|mode|toggle|divert/i,                    'git-branch-outline'],
  [/shower|bath/i,                                  'water-outline'],
  [/faucet|tap|kitchen/i,                           'home-outline'],
  [/flow|pressure|rate/i,                           'speedometer-outline'],
  [/leak|seal|o-ring|gasket/i,                      'shield-outline'],
  [/taste|smell|odour|color|colour|turbid/i,        'flask-outline'],
  [/contact|support|help|ticket/i,                  'headset-outline'],
  [/week|month|year|schedule|reminder/i,            'calendar-outline'],
];

function iconForHeading(heading: string, fallback: string): string {
  for (const [re, icon] of HEADING_ICON_MAP) {
    if (re.test(heading)) return icon;
  }
  return fallback;
}

type GuideMedia = NonNullable<GuideSection['media']>[number];

function GuideVideoBlock({ media, guideId }: { media: GuideMedia; guideId: string }) {
  const colors = useColors();
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
  });
  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => {
      trackEvent('guide_media_completed', { guideId, mediaKind: 'video' });
    });
    return () => subscription.remove();
  }, [guideId, player]);
  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') {
        setFailed(true);
        trackEvent('guide_media_failed', { guideId, mediaKind: 'video' });
      }
    });
    return () => subscription.remove();
  }, [guideId, player]);
  const openMedia = () => { void Linking.openURL(resolveMediaUrl(media.url)); };
  const startVideo = () => {
    try {
      player.replace(resolveMediaUrl(media.url));
      setPlaying(true);
      player.play();
      trackEvent('guide_media_started', { guideId, mediaKind: 'video' });
    } catch {
      setFailed(true);
      trackEvent('guide_media_failed', { guideId, mediaKind: 'video' });
    }
  };
  return failed ? (
    <View style={[styles.mediaFallback, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <Ionicons name="videocam-off-outline" size={18} color={colors.mutedForeground} />
      <Text style={[styles.mediaFallbackText, { color: colors.mutedForeground }]}>Video unavailable</Text>
       <TouchableOpacity onPress={() => { setFailed(false); setPlaying(false); }}><Text style={{ color: colors.primary, fontWeight: '700' }}>Retry</Text></TouchableOpacity>
       <TouchableOpacity onPress={openMedia}><Text style={{ color: colors.primary, fontWeight: '700' }}>Open</Text></TouchableOpacity>
    </View>
  ) : (
    <View style={styles.mediaFrame}>
      {!playing && media.posterUrl ? (
        <Image source={{ uri: resolveMediaUrl(media.posterUrl) }} style={styles.mediaImage} contentFit="cover" accessibilityLabel={media.altText} onError={() => { setFailed(true); trackEvent('guide_media_failed', { guideId, mediaKind: 'video' }); }} />
      ) : (
        <VideoView player={player} style={styles.mediaImage} contentFit="contain" nativeControls={playing} />
      )}
      {!playing && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Play ${media.altText}`} onPress={startVideo} style={styles.playButton}>
          <Ionicons name="play" size={22} color="#fff" />
        </Pressable>
      )}
      {media.caption ? <Text style={[styles.mediaCaption, { color: colors.mutedForeground }]}>{media.caption}</Text> : null}
    </View>
  );
}

function GuideMediaBlock({ media, guideId }: { media: GuideMedia; guideId: string }) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const openMedia = () => { void Linking.openURL(resolveMediaUrl(media.url)); };
  if (media.kind === 'video') return <GuideVideoBlock media={media} guideId={guideId} />;
  if (failed) {
    return (
      <View style={[styles.mediaFallback, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <Ionicons name="image-outline" size={18} color={colors.mutedForeground} />
        <Text style={[styles.mediaFallbackText, { color: colors.mutedForeground }]}>Media unavailable</Text>
        <TouchableOpacity onPress={() => setFailed(false)}><Text style={{ color: colors.primary, fontWeight: '700' }}>Retry</Text></TouchableOpacity>
        <TouchableOpacity onPress={openMedia}><Text style={{ color: colors.primary, fontWeight: '700' }}>Open</Text></TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={styles.mediaFrame}>
       <Image source={{ uri: resolveMediaUrl(media.url) }} style={styles.mediaImage} contentFit="contain" accessibilityLabel={media.altText}
         onLoad={() => trackEvent('guide_media_completed', { guideId, mediaKind: 'image' })}
         onError={() => { setFailed(true); trackEvent('guide_media_failed', { guideId, mediaKind: 'image' }); }} />
      {media.caption ? <Text style={[styles.mediaCaption, { color: colors.mutedForeground }]}>{media.caption}</Text> : null}
    </View>
  );
}

// ── Compact inline illustration strip ────────────────────────────────────────
function IllustrationStrip({
  icon, accentColor, stepCount,
}: { icon: string; accentColor: string; stepCount?: number }) {
  return (
    <View style={[styles.illStrip, { backgroundColor: accentColor + '10', borderColor: accentColor + '28' }]}>
      <View style={[styles.illIconWrap, { backgroundColor: accentColor + '20' }]}>
        <Ionicons name={icon as never} size={22} color={accentColor} />
      </View>
      {stepCount != null && stepCount > 0 && (
        <View style={[styles.illStepBadge, { backgroundColor: accentColor + '18' }]}>
          <Ionicons name="footsteps-outline" size={11} color={accentColor} />
          <Text style={[styles.illStepText, { color: accentColor }]}>{stepCount} steps</Text>
        </View>
      )}
      {/* decorative dots */}
      <View style={{ flex: 1 }} />
      {[0,1,2,3].map(i => (
        <View key={i} style={[styles.illDot, { backgroundColor: accentColor + (i % 2 === 0 ? '30' : '18') }]} />
      ))}
    </View>
  );
}

// ── Collapsible section card ──────────────────────────────────────────────────
function SectionCard({
  section, index, guideIcon, accentColor, defaultOpen, guideId,
}: {
  section: GuideSection; index: number; guideIcon: string;
  accentColor: string; defaultOpen: boolean; guideId: string;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(defaultOpen);

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(o => !o);
  }, []);

  const illIcon   = section.illustrationIcon ?? iconForHeading(section.heading, guideIcon);
  const hasContent = section.body || (section.steps && section.steps.length > 0)
    || section.tip || section.warning;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View {...(Platform.OS === 'web' ? headingProps(2) : {})}>
        <TouchableOpacity onPress={toggle} activeOpacity={0.7} style={styles.cardHeader}
          accessibilityRole="button" accessibilityLabel={section.heading}
          accessibilityState={{ expanded: open }} aria-expanded={open}>
          <View style={[styles.sectionNum, { backgroundColor: accentColor + '18' }]}>
            <Text style={[styles.sectionNumText, { color: accentColor }]}>{index + 1}</Text>
          </View>
          <Text {...(Platform.OS !== 'web' ? headingProps(2) : {})}
            style={[styles.cardHeading, { color: colors.text }]} numberOfLines={open ? undefined : 2}>
            {section.heading}
          </Text>
          {hasContent && (
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
          )}
        </TouchableOpacity>
      </View>

      {open && hasContent && (
        <View style={styles.cardBody}>
          {/* Compact illustration strip */}
          <IllustrationStrip icon={illIcon} accentColor={accentColor} stepCount={section.steps?.length} />

          {section.body ? (
            <Text style={[styles.body, { color: colors.mutedForeground }]}>{section.body}</Text>
          ) : null}

          {section.steps ? (
            <View style={styles.steps}>
              {section.steps.map((step, i) => (
                <View key={i} style={styles.step}>
                  <View style={[styles.stepNumber, { backgroundColor: accentColor }]}>
                    <Text style={styles.stepNumberText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.stepText, { color: colors.text }]}>{step}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {section.tip ? (
            <View style={[styles.callout, { backgroundColor: accentColor + '10', borderColor: accentColor + '35' }]}>
              <Ionicons name="bulb-outline" size={15} color={accentColor} style={{ marginTop: 1 }} />
              <Text style={[styles.calloutText, { color: colors.text }]}>{section.tip}</Text>
            </View>
          ) : null}

          {section.warning ? (
            <View style={[styles.callout, { backgroundColor: '#FFF3CD', borderColor: '#F59E0B' }]}>
              <Ionicons name="warning-outline" size={15} color="#D97706" style={{ marginTop: 1 }} />
              <Text style={[styles.calloutText, { color: '#92400E' }]}>{section.warning}</Text>
            </View>
          ) : null}
          {section.media?.map((media) => <GuideMediaBlock key={media.id} media={media} guideId={guideId} />)}
        </View>
      )}
    </View>
  );
}

// ── Customer satisfaction widget ──────────────────────────────────────────────
const FOLLOW_UP_OPTIONS = [
  'Steps were unclear',
  'Information was incomplete',
  'Too long / too detailed',
  'Didn\'t apply to my product',
  'Other',
];

type SatState = 'idle' | 'positive' | 'negative' | 'followup' | 'done';

function SatisfactionWidget({ accentColor }: { accentColor: string }) {
  const colors = useColors();
  const [state, setState]       = useState<SatState>('idle');
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment]   = useState('');

  const toggleOption = (opt: string) =>
    setSelected(s => s.includes(opt) ? s.filter(o => o !== opt) : [...s, opt]);

  if (state === 'done') {
    return (
      <View style={[styles.satBox, { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' }]}>
        <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
        <Text style={[styles.satDoneText, { color: '#15803D' }]}>
          Thank you! Your feedback helps us improve our guides.
        </Text>
      </View>
    );
  }

  if (state === 'positive') {
    return (
      <View style={[styles.satBox, { backgroundColor: accentColor + '10', borderColor: accentColor + '35' }]}>
        <Ionicons name="heart" size={20} color={accentColor} />
        <Text style={[styles.satDoneText, { color: accentColor }]}>
          Great! We're glad this guide was helpful.
        </Text>
      </View>
    );
  }

  if (state === 'negative' || state === 'followup') {
    return (
      <View style={[styles.satFollowUp, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.satFollowTitle, { color: colors.text }]}>
          What could be better?
        </Text>
        <Text style={[styles.satFollowSub, { color: colors.mutedForeground }]}>
          Select all that apply
        </Text>
        <View style={styles.satChips}>
          {FOLLOW_UP_OPTIONS.map(opt => {
            const active = selected.includes(opt);
            return (
              <TouchableOpacity
                key={opt}
                onPress={() => toggleOption(opt)}
                activeOpacity={0.7}
                style={[
                  styles.chip,
                  active
                    ? { backgroundColor: accentColor, borderColor: accentColor }
                    : { backgroundColor: colors.background, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="Any other details? (optional)"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[styles.satInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        <TouchableOpacity
          onPress={() => setState('done')}
          style={[styles.satSubmit, { backgroundColor: accentColor }]}
          activeOpacity={0.8}
        >
          <Text style={styles.satSubmitText}>Send feedback</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // idle — show the initial question
  return (
    <View style={[styles.satBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.satQuestion, { color: colors.text }]}>
        Was this guide helpful?
      </Text>
      <View style={styles.satButtons}>
        <TouchableOpacity
          onPress={() => setState('positive')}
          style={[styles.satBtn, { borderColor: '#16A34A', backgroundColor: '#F0FDF4' }]}
          activeOpacity={0.7}
        >
          <Ionicons name="thumbs-up-outline" size={18} color="#16A34A" />
          <Text style={[styles.satBtnText, { color: '#16A34A' }]}>Yes, helpful</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setState('negative')}
          style={[styles.satBtn, { borderColor: '#DC2626', backgroundColor: '#FFF1F2' }]}
          activeOpacity={0.7}
        >
          <Ionicons name="thumbs-down-outline" size={18} color="#DC2626" />
          <Text style={[styles.satBtnText, { color: '#DC2626' }]}>Not really</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function GuideDetailScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const colors  = useColors();
  const guidesQuery = useQuery({
    queryKey: ['companion', 'guide', id],
    queryFn: () => fetchPublishedGuide(String(id)),
    placeholderData: () => GUIDES.find((guide) => guide.id === id),
    staleTime: 5 * 60 * 1000,
  });
  const guide = guidesQuery.data;
  useEffect(() => {
    if (guide) trackEvent('guide_opened', { guideId: guide.id });
  }, [guide?.id]);

  if (!guide) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.notFound}>
          <Ionicons name="document-outline" size={40} color={colors.border} />
          <Text style={[styles.notFoundText, { color: colors.text }]}>Guide not found</Text>
          <TouchableOpacity onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.backBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const accent = colors.primary;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, {
        backgroundColor: colors.card,
        borderBottomColor: colors.border,
        paddingTop: topPad + 12,
      }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={[styles.categoryPill, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.categoryPillText, { color: colors.primary }]}>{guide.category}</Text>
          </View>
        </View>
        <Text style={[styles.readTime, { color: colors.mutedForeground }]}>{guide.readTime}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Platform.OS === 'web' ? 40 : 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: colors.primaryLight }]}>
          <View style={styles.heroRow}>
            <View style={[styles.heroIcon, { backgroundColor: colors.primary }]}>
              <Ionicons name={guide.icon as never} size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text {...headingProps(1)} style={[styles.heroTitle, { color: colors.text }]}>{guide.title}</Text>
              <Text style={[styles.heroProducts, { color: colors.mutedForeground }]}>{guide.products}</Text>
            </View>
          </View>
          <Text style={[styles.heroSummary, { color: colors.text }]}>{guide.summary}</Text>
          <View style={[styles.sectionCountPill, { backgroundColor: colors.primary + '20' }]}>
            <Ionicons name="list-outline" size={12} color={colors.primary} />
            <Text style={[styles.sectionCountText, { color: colors.primary }]}>
              {guide.sections.length} sections · tap to expand
            </Text>
          </View>
        </View>

        {/* Collapsible sections */}
        {guide.sections.map((section, si) => (
          <SectionCard
            key={si}
            section={section}
            index={si}
            guideIcon={guide.icon}
            accentColor={accent}
            defaultOpen={si === 0}
            guideId={guide.id}
          />
        ))}

        {/* Satisfaction widget */}
        <SatisfactionWidget accentColor={accent} />

        {/* Footer CTA */}
        <View style={[styles.footer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="headset-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.footerTitle, { color: colors.text }]}>Still need help?</Text>
            <TouchableOpacity onPress={() => Linking.openURL(SUPPORT_TEL)}>
              <Text style={[styles.footerSub, { color: colors.mutedForeground }]}>
                Call {SUPPORT_PHONE} or submit a ticket
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => router.push('/ticket/new' as never)}
            style={[styles.footerBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.footerBtnText}>Get Help</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen:           { flex: 1 },
  notFound:         { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundText:     { fontSize: 16, fontWeight: '600' as const },
  backBtn:          { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  backBtnText:      { color: '#fff', fontWeight: '600' as const },

  header:           { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  headerBack:       { padding: 4 },
  categoryPill:     { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  categoryPillText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  readTime:         { fontSize: 12 },

  content:          { padding: 14, gap: 8 },

  // Hero — compact side-by-side layout
  hero:             { borderRadius: 14, padding: 14, gap: 8 },
  heroRow:          { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon:         { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  heroTitle:        { fontSize: 15, fontWeight: '700' as const, lineHeight: 21 },
  heroProducts:     { fontSize: 11, fontWeight: '500' as const, marginTop: 2 },
  heroSummary:      { fontSize: 13, lineHeight: 20 },
  sectionCountPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  sectionCountText: { fontSize: 11, fontWeight: '600' as const },

  // Card — tighter
  card:             { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  cardHeader:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
  sectionNum:       { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sectionNumText:   { fontSize: 12, fontWeight: '700' as const },
  cardHeading:      { flex: 1, fontSize: 14, fontWeight: '700' as const, lineHeight: 20 },
  cardBody:         { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },

  // Compact illustration strip
  illStrip:         { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, overflow: 'hidden' },
  illIconWrap:      { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  illStepBadge:     { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  illStepText:      { fontSize: 11, fontWeight: '700' as const },
  illDot:           { width: 6, height: 6, borderRadius: 3 },

  body:             { fontSize: 13, lineHeight: 21 },
  steps:            { gap: 8 },
  step:             { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNumber:       { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 },
  stepNumberText:   { color: '#fff', fontSize: 11, fontWeight: '700' as const },
  stepText:         { flex: 1, fontSize: 13, lineHeight: 20 },

  callout:          { flexDirection: 'row', gap: 8, borderWidth: 1, borderRadius: 9, padding: 10, alignItems: 'flex-start' },
  calloutText:      { flex: 1, fontSize: 12, lineHeight: 19 },

  // Satisfaction widget
  satBox:           { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12, alignItems: 'center' },
  satQuestion:      { fontSize: 14, fontWeight: '700' as const, textAlign: 'center' },
  satButtons:       { flexDirection: 'row', gap: 10, width: '100%' },
  satBtn:           { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 9 },
  satBtnText:       { fontSize: 13, fontWeight: '600' as const },
  satDoneText:      { fontSize: 13, fontWeight: '600' as const, textAlign: 'center', flex: 1 },

  satFollowUp:      { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  satFollowTitle:   { fontSize: 14, fontWeight: '700' as const },
  satFollowSub:     { fontSize: 12, marginTop: -4 },
  satChips:         { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip:             { borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  chipText:         { fontSize: 12, fontWeight: '600' as const },
  satInput:         { borderWidth: 1, borderRadius: 9, padding: 10, fontSize: 13, minHeight: 60, textAlignVertical: 'top' },
  satSubmit:        { borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  satSubmitText:    { color: '#fff', fontSize: 14, fontWeight: '700' as const },

  // Footer
  footer:           { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 13 },
  footerTitle:      { fontSize: 13, fontWeight: '700' as const },
  footerSub:        { fontSize: 11, marginTop: 1 },
  footerBtn:        { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9 },
  footerBtnText:    { color: '#fff', fontSize: 12, fontWeight: '600' as const },
  mediaFrame:       { borderRadius: 10, overflow: 'hidden', gap: 5 },
  mediaImage:       { width: '100%', minHeight: 160, aspectRatio: 16 / 9, backgroundColor: '#0F172A' },
  mediaCaption:     { fontSize: 11, lineHeight: 17 },
  playButton:       { position: 'absolute', alignSelf: 'center', top: '38%', width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.86)' },
  mediaFallback:    { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12 },
  mediaFallbackText:{ flex: 1, fontSize: 12 },
});
