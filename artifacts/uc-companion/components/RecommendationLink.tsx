import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { catalogueQueryKey } from '@/lib/catalogueQuery';

// Controlled legacy mapping by verified catalogue SKU, never fuzzy text search.
const LEGACY: Record<string, { sku: string; name: string }> = {
  'Shower & skin filtration': { sku: 'UC-SHW-DCR-017', name: 'Derma Care' },
  'Filter bottles & portable filtration': { sku: 'UC-BTL-HFX-001', name: 'Hydra Flux' },
  'Survivor-grade portable filtration': { sku: 'UC-STR-SVV-007', name: 'Survivor Straw' },
  'Home & kitchen filtration': { sku: 'UC-FCT-SWH-011', name: 'Sweet Home' },
  'Sweet Home faucet filtration': { sku: 'UC-FCT-SWH-011', name: 'Sweet Home' },
};

export default function RecommendationLink({ recommendation: rec }: { recommendation: {
  name: string; productId?: number; productName?: string; action?: string;
} }) {
  const api = useApi();
  const colors = useColors();
  const router = useRouter();
  const { data: products, isLoading, isError } = useQuery({
    queryKey: catalogueQueryKey(), queryFn: ({ signal }) => api.getProducts(undefined, signal), staleTime: 60000,
  });
  const legacy = LEGACY[rec.name];
  const product = rec.productId
    ? products?.find(p => p.id === rec.productId && p.name === rec.productName)
    : rec.action === 'enquiry' ? undefined : products?.find(p => p.sku === legacy?.sku && p.name === legacy?.name);
  return (
    <View style={{ gap: 6 }}>
      <TouchableOpacity accessibilityRole="link" onPress={() => product
        ? router.push(`/product/${product.id}` as never)
        : router.push({ pathname: '/enquiry', params: { productName: rec.name } } as never)}>
        <Text style={{ color: colors.primary, fontSize: 19, fontWeight: '700', textDecorationLine: 'underline' }}>{product?.name ?? rec.productName ?? rec.name}</Text>
      </TouchableOpacity>
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
        {product ? 'View product details · confirm suitability with our team' : isLoading ? 'Checking availability · tap to enquire' :
          isError ? 'Catalogue unavailable · tap to enquire' : legacy ? 'This product is not currently available · tap to enquire' : 'Talk to us about this recommendation'}
      </Text>
    </View>
  );
}