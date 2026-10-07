import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useFilterStatus } from '@/hooks/useFilterStatus';
import PurchaseActivationSection from '@/components/PurchaseActivationSection';

/** Compact shared card, rendered even when a primary filter is active. */
export default function RegisterFilterPrompt({ onRegistered }: { onRegistered?: () => void }) {
  const { user } = useAuth();
  const status = useFilterStatus(), client = useQueryClient();
  return <PurchaseActivationSection compact activation={status.activation} onRegistered={() => {
      void client.invalidateQueries({ queryKey: ['filter-cycle', user?.id] });
      onRegistered?.();
    }} />;
}
