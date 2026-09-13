import React, { useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Share, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { PersonalImpact } from '@/hooks/useApi';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

interface Props {
  visible: boolean;
  impact: PersonalImpact;
  onClose: () => void;
}

export function buildShareMessage(totalLitres: number) {
  return `I’ve refilled ${totalLitres} litres with Ultra-Clear! Cleaner water, zero plastic waste. Join me in the green-living community.`;
}

export default function ImpactShareModal({ visible, impact, onClose }: Props) {
  const colors = useColors();
  const badgeRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  async function handleShare() {
    if (sharing) return;
    
    const message = buildShareMessage(impact.totalLitres);
    const url = Platform.OS === 'ios' ? 'https://ultra-clear.com/app' : undefined;

    setSharing(true);
    
    try {
      if (Platform.OS !== 'web' && await Sharing.isAvailableAsync()) {
        try {
          // Capture the badge view as a PNG image
          const uri = await captureRef(badgeRef, {
            format: 'png',
            quality: 1,
          });
          
          // Share the image
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: 'Share your impact',
            UTI: 'public.png',
          });
          return;
        } catch (captureError) {
          console.warn('Failed to capture or share image natively, falling back to text:', captureError);
          // Fallback down below
        }
      }

      // Fallback: Web or native when capture fails or Sharing is unavailable
      await Share.share({ message, url });
    } catch (err) {
      console.error('Failed to share:', err);
    } finally {
      setSharing(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {
      if (!sharing) onClose();
    }}>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <TouchableOpacity 
            onPress={onClose} 
            style={styles.closeBtn} 
            disabled={sharing}
            accessibilityLabel="Close share modal"
          >
            <Ionicons name="close" size={24} color={colors.mutedForeground} />
          </TouchableOpacity>
          
          <Text style={[styles.title, { color: colors.text }]}>Share your impact</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Inspire others by showing your contribution.
          </Text>

          <View 
            ref={badgeRef}
            collapsable={false}
            style={[styles.badge, { backgroundColor: colors.primary, borderColor: colors.primaryLight }]}
          >
            <View style={styles.badgeHeader}>
              <Ionicons name="water" size={24} color="#fff" />
              <Text style={styles.badgeBrand}>Ultra-Clear</Text>
            </View>
            <View style={styles.badgeBody}>
              <Text style={styles.badgeValue}>{impact.totalLitres}</Text>
              <Text style={styles.badgeLabel}>LITRES REFILLED</Text>
            </View>
            <View style={styles.badgeFooter}>
              <Text style={styles.badgeStar}>{impact.starLevel} ★ Contributor</Text>
              <Text style={styles.badgeSlogan}>Zero plastic waste.</Text>
            </View>
          </View>

          <TouchableOpacity 
            onPress={handleShare} 
            disabled={sharing}
            accessibilityLabel="Share your impact badge"
            accessibilityState={{ busy: sharing }}
            style={[styles.shareBtn, { backgroundColor: colors.primary, opacity: sharing ? 0.8 : 1 }]}
          >
            {sharing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="share-outline" size={20} color="#fff" />
                <Text style={styles.shareBtnText}>Share Status</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 6,
    marginBottom: 24,
    textAlign: 'center',
  },
  badge: {
    width: '100%',
    borderRadius: 20,
    padding: 24,
    borderWidth: 4,
    alignItems: 'center',
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  badgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  badgeBrand: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  badgeBody: {
    alignItems: 'center',
    marginBottom: 24,
  },
  badgeValue: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -1.5,
    lineHeight: 60,
  },
  badgeLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 4,
  },
  badgeFooter: {
    width: '100%',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    paddingTop: 16,
    gap: 4,
  },
  badgeStar: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  badgeSlogan: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '500',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    minHeight: 52,
  },
  shareBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
