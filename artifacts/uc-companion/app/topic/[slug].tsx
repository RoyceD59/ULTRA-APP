import React from 'react';
import PublicRecordDocument from '@/components/PublicRecordDocument';
import { useLocalSearchParams } from 'expo-router';

export default function TopicScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <PublicRecordDocument route={`/topic/${slug}`} />;
}
