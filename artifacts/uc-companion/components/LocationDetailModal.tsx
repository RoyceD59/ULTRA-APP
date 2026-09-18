import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useApi, MapLocation, LocationRatingAggregate, LocationRating } from '@/hooks/useApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import StarRating from '@/components/StarRating';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

export default function LocationDetailModal({
  location,
  visible,
  onClose,
  onDirections
}: {
  location: MapLocation | null;
  visible: boolean;
  onClose: () => void;
  onDirections: (location: MapLocation) => void;
}) {
  const colors = useColors();
  const api = useApi();
  const { token } = useAuth();
  const [showRatingForm, setShowRatingForm] = useState(false);
  const [reportingRatingId, setReportingRatingId] = useState<string | null>(null);

  const { data: aggregate, isLoading: aggLoading } = useQuery({
    queryKey: ['locationRatings', location?.id],
    queryFn: () => api.getLocationRatingAggregate(location!.id),
    enabled: !!location?.id,
  });

  const { data: myRatingRes } = useQuery({
    queryKey: ['myLocationRating', location?.id],
    queryFn: () => api.getMyLocationRating(location!.id),
    enabled: !!location?.id && !!token,
  });

  const myRating = myRatingRes?.rating;

  useEffect(() => {
    if (!visible) {
      setShowRatingForm(false);
      setReportingRatingId(null);
    }
  }, [visible]);

  if (!location) return null;

  const CENTRE_PIN = '#0054A6';
  const ATM_PIN    = '#00B4D8';
  const VENDOR_PIN = '#2E7D32';
  const REFILL_PIN = '#1976D2';
  const TAP_PIN    = '#0288D1';

  let iconColor = ATM_PIN;
  let bgColor = '#E0F7FA';
  let iconName: keyof typeof Ionicons.glyphMap = 'water';

  if (location.type === 'experience_centre') {
    iconColor = colors.primary;
    bgColor = colors.primaryLight;
    iconName = 'business';
  } else if (location.type === 'vendor') {
    iconColor = VENDOR_PIN;
    bgColor = '#E8F5E9';
    iconName = 'business';
  } else if (location.type === 'refill_station') {
    iconColor = REFILL_PIN;
    bgColor = '#E3F2FD';
    iconName = 'pint';
  } else if (location.type === 'city_tap') {
    iconColor = TAP_PIN;
    bgColor = '#E1F5FE';
    iconName = 'water-outline';
  }

  const overallAvg = aggregate && aggregate.count > 0 && aggregate.averages ?
    ((aggregate.averages.waterQuality || 0) +
     (aggregate.averages.cleanliness || 0) +
     (aggregate.averages.equipmentCondition || 0) +
     (aggregate.averages.serviceReliability || 0) +
     (aggregate.averages.safetyConfidence || 0)) / 5 : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[s.container, { backgroundColor: colors.background }]}>
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <Text style={[s.title, { color: colors.text }]}>Location Details</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {!showRatingForm && !reportingRatingId ? (
          <ScrollView contentContainerStyle={s.content}>
            <View style={s.topInfo}>
              <View style={[s.iconWrap, { backgroundColor: bgColor }]}>
                <Ionicons name={iconName} size={32} color={iconColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.name, { color: colors.text }]}>{location.name}</Text>
                <Text style={[s.address, { color: colors.mutedForeground }]}>{location.address}</Text>
                {location.type === 'vendor' && (
                  <View style={s.vendorBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={VENDOR_PIN} />
                    <Text style={[s.vendorBadgeTxt, { color: VENDOR_PIN }]}>Verified Ultra-Clear vendor</Text>
                  </View>
                )}
                {location.type === 'city_tap' && (
                  <View style={s.cityTapBadge}>
                    <Ionicons name="information-circle" size={14} color={TAP_PIN} />
                    <Text style={[s.vendorBadgeTxt, { color: TAP_PIN }]}>Municipal source</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.metaRow}>
                <Ionicons name="time-outline" size={16} color={colors.mutedForeground} />
                <Text style={[s.metaTxt, { color: colors.text }]}>{location.hours}</Text>
              </View>
              {location.phone && (
                <View style={s.metaRow}>
                  <Ionicons name="call-outline" size={16} color={colors.mutedForeground} />
                  <Text style={[s.metaTxt, { color: colors.text }]}>{location.phone}</Text>
                </View>
              )}
              {location.type === 'city_tap' && (
                <>
                  {location.city && location.countryIso && (
                    <View style={s.metaRow}>
                      <Ionicons name="location-outline" size={16} color={colors.mutedForeground} />
                      <Text style={[s.metaTxt, { color: colors.text }]}>{location.city}, {location.countryIso}</Text>
                    </View>
                  )}
                  {location.municipal && (
                    <View style={s.metaRow}>
                      <Ionicons name="business-outline" size={16} color={colors.mutedForeground} />
                      <Text style={[s.metaTxt, { color: colors.text }]}>Operator: {location.municipal}</Text>
                    </View>
                  )}
                  {location.sourceAttribution && (
                    <View style={s.metaRow}>
                      <Ionicons name="water-outline" size={16} color={colors.mutedForeground} />
                      <Text style={[s.metaTxt, { color: colors.text }]}>Source: {location.sourceAttribution}</Text>
                    </View>
                  )}
                  {location.accessNotes && (
                    <View style={s.metaRow}>
                      <Ionicons name="information-circle-outline" size={16} color={colors.mutedForeground} />
                      <Text style={[s.metaTxt, { color: colors.text, flex: 1 }]}>{location.accessNotes}</Text>
                    </View>
                  )}
                </>
              )}
            </View>

            <TouchableOpacity
              onPress={() => onDirections(location)}
              style={[s.btnPrimary, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="navigate" size={18} color="#fff" />
              <Text style={s.btnPrimaryTxt}>Get Directions</Text>
            </TouchableOpacity>

            <View style={s.divider} />

            <View style={s.ratingsSection}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Community Ratings</Text>
              <Text style={[s.advisoryTxt, { color: colors.mutedForeground }]}>These are advisory community observations, not laboratory evidence.</Text>

              {aggLoading ? (
                <ActivityIndicator style={{ marginVertical: 20 }} />
              ) : aggregate && aggregate.count > 0 ? (
                <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={s.ratingRow}>
                    <Text style={[s.ratingLabel, { color: colors.text }]}>Overall</Text>
                    <View style={s.ratingScoreRow}>
                      <StarRating rating={overallAvg || 0} size={16} />
                      <Text style={[s.ratingScoreTxt, { color: colors.text }]}>{overallAvg?.toFixed(1)}</Text>
                    </View>
                  </View>
                  <Text style={[s.ratingCount, { color: colors.mutedForeground }]}>Based on {aggregate.count} rating{aggregate.count === 1 ? '' : 's'}</Text>

                  <View style={s.breakdown}>
                    <RatingBar label="Water Quality" value={aggregate.averages.waterQuality} colors={colors} />
                    <RatingBar label="Cleanliness" value={aggregate.averages.cleanliness} colors={colors} />
                    <RatingBar label="Equipment" value={aggregate.averages.equipmentCondition} colors={colors} />
                    <RatingBar label="Reliability" value={aggregate.averages.serviceReliability} colors={colors} />
                    <RatingBar label="Safety" value={aggregate.averages.safetyConfidence} colors={colors} />
                  </View>
                </View>
              ) : (
                <Text style={[s.emptyTxt, { color: colors.mutedForeground }]}>No community ratings yet.</Text>
              )}

              {token ? (
                <TouchableOpacity
                  style={[s.btnOutline, { borderColor: colors.border }]}
                  onPress={() => setShowRatingForm(true)}
                >
                  <Text style={[s.btnOutlineTxt, { color: colors.text }]}>
                    {myRating ? 'Edit your rating' : 'Rate this location'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={[s.signInPrompt, { color: colors.mutedForeground }]}>Sign in to rate this location.</Text>
              )}

              {aggregate?.ratings && aggregate.ratings.length > 0 && (
                <View style={s.reviewsSection}>
                  <Text style={[s.sectionTitle, { color: colors.text }]}>Community Reviews</Text>
                  {aggregate.ratings.map((rating) => {
                    const ratingAvg = (rating.waterQuality + rating.cleanliness + rating.equipmentCondition + rating.serviceReliability + rating.safetyConfidence) / 5;
                    return (
                      <View key={rating.id} style={[s.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <View style={s.reviewHeader}>
                          <StarRating rating={ratingAvg} size={14} />
                          {rating.createdAt && (
                            <Text style={[s.reviewDate, { color: colors.mutedForeground }]}>
                              {new Date(rating.createdAt).toLocaleDateString()}
                            </Text>
                          )}
                        </View>
                        {rating.comment ? (
                          <Text style={[s.reviewComment, { color: colors.text }]}>{rating.comment}</Text>
                        ) : null}
                        {token && rating.id !== myRating?.id && (
                          <TouchableOpacity
                            style={s.reportBtn}
                            onPress={() => setReportingRatingId(rating.id)}
                          >
                            <Ionicons name="flag-outline" size={14} color={colors.mutedForeground} />
                            <Text style={[s.reportBtnTxt, { color: colors.mutedForeground }]}>Report</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </ScrollView>
        ) : showRatingForm ? (
          <RatingForm
            location={location}
            existingRating={myRating}
            onClose={() => setShowRatingForm(false)}
          />
        ) : reportingRatingId ? (
          <ReportForm
            locationId={location.id}
            ratingId={reportingRatingId}
            onClose={() => setReportingRatingId(null)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function RatingBar({ label, value, colors }: { label: string, value?: number, colors: any }) {
  if (value === undefined) return null;
  return (
    <View style={s.barRow}>
      <Text style={[s.barLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={s.barTrack}>
        <View style={[s.barFill, { backgroundColor: colors.primary, width: `${(value / 5) * 100}%` }]} />
      </View>
      <Text style={[s.barValue, { color: colors.text }]}>{value.toFixed(1)}</Text>
    </View>
  );
}

function ReportForm({ locationId, ratingId, onClose }: { locationId: string, ratingId: string, onClose: () => void }) {
  const colors = useColors();
  const api = useApi();
  const [reason, setReason] = useState<'' | 'spam' | 'unsafe' | 'inaccurate' | 'offensive' | 'other'>('');
  const [detail, setDetail] = useState('');

  const REASONS: Array<{ label: string; value: 'spam' | 'unsafe' | 'inaccurate' | 'offensive' | 'other' }> = [
    { label: 'Spam or advertising', value: 'spam' },
    { label: 'Unsafe or malicious', value: 'unsafe' },
    { label: 'Fake or misleading observation', value: 'inaccurate' },
    { label: 'Offensive or inappropriate content', value: 'offensive' },
    { label: 'Other', value: 'other' }
  ];

  const mutation = useMutation({
    mutationFn: () => {
      if (!reason) throw new Error('Reason is required');
      return api.reportLocationRating(locationId, ratingId, { reason, detail });
    },
    onSuccess: () => {
      onClose();
    }
  });

  return (
    <KeyboardAwareScrollViewCompat style={s.content}>
      <Text style={[s.sectionTitle, { color: colors.text, marginBottom: 16 }]}>Report Review</Text>
      <Text style={[s.advisoryTxt, { color: colors.mutedForeground, marginBottom: 24 }]}>
        Please tell us why you are reporting this review. Our moderation team will investigate.
      </Text>

      <View style={{ gap: 12, marginBottom: 24 }}>
        {REASONS.map(r => (
          <TouchableOpacity
            key={r.value}
            onPress={() => setReason(r.value)}
            style={[s.reasonBtn, { borderColor: reason === r.value ? colors.primary : colors.border, backgroundColor: reason === r.value ? colors.primaryLight : colors.surface }]}
          >
            <Text style={{ color: reason === r.value ? colors.primary : colors.text, fontWeight: reason === r.value ? '600' : '400' }}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.inputWrapper}>
        <Text style={[s.inputLabel, { color: colors.text }]}>Additional details (optional)</Text>
        <TextInput
          style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface, minHeight: 80 }]}
          placeholder="Provide more context..."
          placeholderTextColor={colors.mutedForeground}
          value={detail}
          onChangeText={setDetail}
          multiline
          maxLength={500}
          textAlignVertical="top"
        />
      </View>

      {mutation.isError && (
        <Text style={[s.directionsError, { color: 'red', marginBottom: 16 }]}>Failed to submit report. Please try again.</Text>
      )}

      <View style={s.formActions}>
        <TouchableOpacity style={[s.btnOutline, { flex: 1, borderColor: colors.border }]} onPress={onClose}>
          <Text style={[s.btnOutlineTxt, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btnPrimary, { flex: 1, backgroundColor: reason ? colors.primary : colors.border }]}
          disabled={!reason || mutation.isPending}
          onPress={() => mutation.mutate()}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryTxt}>Submit Report</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

function RatingForm({ location, existingRating, onClose }: { location: MapLocation, existingRating?: LocationRating | null, onClose: () => void }) {
  const colors = useColors();
  const api = useApi();
  const queryClient = useQueryClient();

  const [scores, setScores] = useState({
    waterQuality: existingRating?.waterQuality || 0,
    cleanliness: existingRating?.cleanliness || 0,
    equipmentCondition: existingRating?.equipmentCondition || 0,
    serviceReliability: existingRating?.serviceReliability || 0,
    safetyConfidence: existingRating?.safetyConfidence || 0,
  });
  const [comment, setComment] = useState(existingRating?.comment || '');

  const mutation = useMutation({
    mutationFn: () => api.upsertLocationRating(location.id, { ...scores, comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locationRatings', location.id] });
      queryClient.invalidateQueries({ queryKey: ['myLocationRating', location.id] });
      onClose();
    }
  });

  const canSubmit = Object.values(scores).every(v => v > 0);

  return (
    <KeyboardAwareScrollViewCompat style={s.content}>
      <Text style={[s.sectionTitle, { color: colors.text, marginBottom: 16 }]}>Your Rating</Text>
      <Text style={[s.advisoryTxt, { color: colors.mutedForeground }]}>Observations help the community. Keep them accurate and helpful.</Text>

      <View style={s.ratingInputList}>
        {(Object.keys(scores) as Array<keyof typeof scores>).map(key => {
          const label = {
            waterQuality: 'Water Quality',
            cleanliness: 'Cleanliness',
            equipmentCondition: 'Equipment Condition',
            serviceReliability: 'Service Reliability',
            safetyConfidence: 'Safety Confidence'
          }[key];
          return (
            <View key={key} style={s.ratingInputRow}>
              <Text style={[s.ratingInputLabel, { color: colors.text }]}>{label}</Text>
              <StarRating
                rating={scores[key]}
                size={28}
                onChange={(val) => setScores(s => ({ ...s, [key]: val }))}
              />
            </View>
          );
        })}
      </View>

      <View style={s.inputWrapper}>
        <Text style={[s.inputLabel, { color: colors.text }]}>Comment (optional)</Text>
        <TextInput
          style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          placeholder="Share details about your visit..."
          placeholderTextColor={colors.mutedForeground}
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={1000}
          textAlignVertical="top"
        />
      </View>

      <View style={s.formActions}>
        <TouchableOpacity style={[s.btnOutline, { flex: 1, borderColor: colors.border }]} onPress={onClose}>
          <Text style={[s.btnOutlineTxt, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btnPrimary, { flex: 1, backgroundColor: canSubmit ? colors.primary : colors.border }]}
          disabled={!canSubmit || mutation.isPending}
          onPress={() => mutation.mutate()}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryTxt}>Submit</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontWeight: '600' },
  content: { padding: 16 },
  topInfo: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  iconWrap: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  address: { fontSize: 14, marginBottom: 8 },
  vendorBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cityTapBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vendorBadgeTxt: { fontSize: 12, fontWeight: '600' },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 12, marginBottom: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaTxt: { fontSize: 14 },
  btnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12 },
  btnPrimaryTxt: { color: '#fff', fontSize: 16, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#e5e5e5', marginVertical: 24 },
  ratingsSection: { gap: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  advisoryTxt: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ratingLabel: { fontSize: 16, fontWeight: '600' },
  ratingScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingScoreTxt: { fontSize: 16, fontWeight: '700' },
  ratingCount: { fontSize: 12 },
  breakdown: { marginTop: 12, gap: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  barLabel: { flex: 1, fontSize: 12 },
  barTrack: { flex: 2, height: 6, backgroundColor: '#e5e5e5', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  barValue: { width: 24, fontSize: 12, textAlign: 'right', fontWeight: '500' },
  emptyTxt: { fontSize: 14, fontStyle: 'italic' },
  btnOutline: { padding: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  btnOutlineTxt: { fontSize: 16, fontWeight: '600' },
  signInPrompt: { fontSize: 14, textAlign: 'center', marginTop: 12 },
  ratingInputList: { gap: 20, marginBottom: 24 },
  ratingInputRow: { alignItems: 'center', gap: 8 },
  ratingInputLabel: { fontSize: 15, fontWeight: '500' },
  inputWrapper: { marginBottom: 24 },
  inputLabel: { fontSize: 14, fontWeight: '500', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, minHeight: 100 },
  formActions: { flexDirection: 'row', gap: 12, marginBottom: 40 },
  reviewsSection: { marginTop: 24, gap: 12 },
  reviewCard: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 8 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewDate: { fontSize: 12 },
  reviewComment: { fontSize: 14, lineHeight: 20 },
  reportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 4, paddingVertical: 4 },
  reportBtnTxt: { fontSize: 12, fontWeight: '500' },
  reasonBtn: { padding: 14, borderRadius: 10, borderWidth: 1 },
  directionsError: { fontSize: 13, textAlign: 'center' },
});