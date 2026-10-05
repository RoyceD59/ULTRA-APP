import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useFilterStatus } from '@/hooks/useFilterStatus';
import PurchaseActivationSection from '@/components/PurchaseActivationSection';

/** Server-owned offers: neither order age nor a catalogue match proves eligibility. */
export default function RegisterFilterPrompt({ onRegistered }: { onRegistered?: () => void }) {
  const { user } = useAuth();
  const status = useFilterStatus(), client = useQueryClient();
  return <PurchaseActivationSection compact activation={status.activation} onRegistered={() => {
    void client.invalidateQueries({ queryKey: ['filter-cycle', user?.id] });
    onRegistered?.();
  }} />;
}