import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetRefillFeaturesQueryKey, useGetRefillFeatures, useUpdateRefillFeatures,
  type RefillFeatures,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getAuthHeaders, getTeamUser, isTeamAdmin } from '@/lib/team-auth';

const controls = [
  {
    key: 'careOverview',
    title: 'Care Overview',
    description: 'Show customers the Companion care overview, linking to existing filter tracking, support and free-member features.',
  },
  {
    key: 'refillGovernance',
    title: 'Station & campaign governance preview',
    description: 'Allow administrators to review pilot stations, team assignments and sponsor-funded campaign definitions. Does not issue credit or authorize dispensing.',
  },
] as const;

function useActivationSettings() {
  return useGetRefillFeatures({
    query: {
      queryKey: [...getGetRefillFeaturesQueryKey(), getTeamUser()?.id ?? 'anonymous'],
      enabled: isTeamAdmin() && !!getAuthHeaders(),
      staleTime: 0,
      retry: false,
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
      refetchInterval: 30_000,
    },
    request: { headers: getAuthHeaders() ?? {} },
  });
}

export function RefillActivationControls() {
  const features = useActivationSettings();
  const client = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const update = useUpdateRefillFeatures({
    request: { headers: getAuthHeaders() ?? {} },
    mutation: {
      onSuccess: async (saved, { data }) => {
        client.setQueryData(features.queryKey, saved);
        const key = Object.keys(data)[0] as keyof RefillFeatures;
        const label = controls.find(control => control.key === key)?.title ?? 'Preview';
        setFeedback(`${label} ${saved[key] ? 'activated' : 'deactivated'}.`);
        await Promise.all([
          client.invalidateQueries({ queryKey: getGetRefillFeaturesQueryKey() }),
          client.invalidateQueries({ queryKey: ['admin', 'refill-readiness'] }),
          client.invalidateQueries({ queryKey: ['refill-governance'] }),
        ]);
      },
    },
  });
  if (!isTeamAdmin()) return null;
  const save = (key: keyof RefillFeatures, value: boolean) => {
    setFeedback('');
    update.reset();
    update.mutate({ data: { [key]: value } });
  };
  return <section className="rounded-xl border bg-card p-5 space-y-5" aria-labelledby="activation-heading">
    <div className="space-y-2">
      <h2 id="activation-heading" className="text-lg font-semibold">Feature activation</h2>
      <p className="text-sm text-muted-foreground">Both previews start off. Changes are saved immediately and survive server restarts. Companion checks Care Overview when opened or resumed; no rebuild is required.</p>
    </div>
    {features.isPending ? <p role="status">Loading activation settings…</p> : features.isError ? <div role="alert" className="space-y-2">
      <p>Activation settings could not be loaded. No changes can be made until they are refreshed.</p>
      <Button variant="outline" disabled={features.isFetching} onClick={() => { void features.refetch(); }}>Retry activation settings</Button>
    </div> : <div className="space-y-5">
      {controls.map(control => <div key={control.key} className="flex items-start justify-between gap-5 border-b pb-5 last:border-b-0 last:pb-0">
        <div className="space-y-1">
          <Label htmlFor={`activate-${control.key}`} className="text-base">{control.title}</Label>
          <p id={`activate-${control.key}-help`} className="max-w-xl text-sm text-muted-foreground">{control.description}</p>
          <p className="text-xs font-medium">{features.data?.[control.key] ? 'Active' : 'Off'}</p>
        </div>
        <Switch id={`activate-${control.key}`} aria-describedby={`activate-${control.key}-help`}
          checked={features.data?.[control.key] ?? false} disabled={update.isPending || features.isFetching}
          onCheckedChange={value => save(control.key, value)} />
      </div>)}
      {features.data?.refillGovernance && <Link href="/admin/refill-governance" className="inline-block text-sm underline">Open station and campaign governance →</Link>}
    </div>}
    {update.isPending && <p role="status" className="text-sm">Saving activation settings…</p>}
    {update.isError && <p role="alert" className="text-sm text-destructive">The change was not saved. {update.error.message}</p>}
    {feedback && !update.isPending && <p role="status" className="text-sm">{feedback}</p>}
    <p className="rounded-lg bg-muted p-3 text-sm">Not available for activation: promotional refills, paid refills, a money wallet, paid care and automatic collection. Their payment, funding, consent and dispensing safeguards are not yet complete.</p>
  </section>;
}

/** Server authorization remains authoritative; this gate avoids rendering inert forms. */
export function RefillGovernanceGate({ children }: { children: ReactNode }) {
  const features = useActivationSettings();
  if (features.isPending) return <div className="p-6" role="status">Checking governance activation…</div>;
  if (features.isError) return <div className="p-6 space-y-3" role="alert">
    <p>Governance activation could not be verified. The review forms are unavailable.</p>
    <Button variant="outline" onClick={() => { void features.refetch(); }}>Retry activation settings</Button>
  </div>;
  if (!features.data?.refillGovernance) return <div className="p-6 space-y-3">
    <h1 className="text-2xl font-semibold">Governance preview is off</h1>
    <p>An administrator must activate it before reviewing stations or campaigns.</p>
    <Link href="/admin/refill-readiness" className="underline">Open feature activation</Link>
  </div>;
  return <>{children}</>;
}