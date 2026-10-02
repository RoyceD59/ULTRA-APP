import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { refillCostNames } from '@workspace/api-zod/refill-readiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiUrl } from '@/lib/api-base';
import { getAuthHeaders } from '@/lib/team-auth';
import { parseFixedUnits } from '@/lib/refill-input';
import { RefillGovernanceGate } from '@/components/admin/RefillActivationControls';

type Station = { stationId: string; name: string; active: boolean; verified: boolean; status: 'enable' | 'suspend' | 'unreviewed' };
type Rule = { id: string; campaignKey: string; version: number; stationId: string; creditMl: string; maxGrants: number; status: 'proposed' | 'reviewed' | 'suspended'; proposedBy: string; startsAt: string; endsAt: string };

const base = '/api/uc/admin/refill/governance';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const auth = getAuthHeaders();
  if (!auth) throw new Error('Sign in to Project Hub to continue.');
  const response = await fetch(apiUrl(path), { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result as T;
}

const costLabels: Record<typeof refillCostNames[number], string> = {
  waterPerLitreMinor: 'Water cost per litre (KES)', paymentMinor: 'Payment cost (KES)',
  deliverySupportMinor: 'Delivery and support (KES)', benefitObligationMinor: 'Benefit obligation (KES)', taxMinor: 'Tax (KES)',
};

export default function RefillGovernancePage() {
  return <RefillGovernanceGate><RefillGovernanceContent /></RefillGovernanceGate>;
}

function RefillGovernanceContent() {
  const stations = useQuery({ queryKey: ['refill-governance', 'stations'], queryFn: () => request<Station[]>(`${base}/stations`), staleTime: 0, refetchInterval: 30_000 });
  const rules = useQuery({ queryKey: ['refill-governance', 'rules'], queryFn: () => request<Rule[]>(`${base}/rules`), staleTime: 0, refetchInterval: 30_000 });
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const set = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value }));
  const field = (key: string, label: string, type = 'text') => <div className="space-y-2" key={key}>
    <Label htmlFor={`gov-${key}`}>{label}</Label>
    <Input id={`gov-${key}`} type={type} value={values[key] ?? ''} onChange={event => set(key, event.target.value)} disabled={busy} />
  </div>;
  const stationPicker = (key: string, label: string, requireEnabled = false) => <div className="space-y-2" key={key}>
    <Label htmlFor={`gov-${key}`}>{label}</Label>
    <select id={`gov-${key}`} className="flex min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={values[key] ?? ''} onChange={event => set(key, event.target.value)} disabled={busy || !stations.data?.length}>
      <option value="">Choose a verified station</option>
      {stations.data?.filter(item => item.active && item.verified && (!requireEnabled || item.status === 'enable')).map(item => <option key={item.stationId} value={item.stationId}>{item.name} ({item.stationId})</option>)}
    </select>
  </div>;
  const refresh = async () => { await Promise.all([stations.refetch(), rules.refetch()]); };
  const perform = async (path: string, body: unknown, success: string) => {
    setBusy(true); setError(''); setFeedback('');
    try { await request(path, body); await refresh(); setFeedback(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The review action failed.'); }
    finally { setBusy(false); }
  };
  const auditReason = () => {
    const value = values.reason?.trim() ?? '';
    if (value.length < 8 || value.length > 500) throw new Error('Enter an audit reason of 8–500 characters before changing a record.');
    return value;
  };
  const action = async (path: string, success: string) => {
    try { await perform(path, { reason: auditReason() }, success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'A reason is required.'); }
  };
  const proposal = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const campaignKey = values.campaignKey?.trim() ?? '';
      const version = Number(values.version);
      const costs = Object.fromEntries(refillCostNames.map(name => [name, values[name]?.trim() ? parseFixedUnits(values[name]!, 2) : null]));
      await perform(`${base}/rules`, {
        campaignKey, version, stationId: values.stationId ?? '', eligibilityPolicy: 'manual_review',
        maxGrants: Number(values.maxGrants), startsAt: new Date(values.startsAt ?? '').toISOString(), endsAt: new Date(values.endsAt ?? '').toISOString(),
        scenario: { pricingVersion: values.pricingVersion?.trim() ?? '', campaignVersion: `${campaignKey}:${version}`,
          volumeMl: parseFixedUnits(values.volume ?? '', 3), cashChargeMinor: 0,
          sponsorFundingMinor: parseFixedUnits(values.sponsor ?? '', 2), costs },
      }, 'Campaign version recorded for independent review. No credit or refill was activated.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enter valid campaign terms.'); }
  };
  return <div className="max-w-6xl mx-auto space-y-7 p-4 sm:p-6">
    <header className="space-y-2"><Link href="/admin/refill-readiness" className="text-sm underline">← Care and refill activation</Link>
      <h1 className="text-2xl font-semibold">Controlled refill governance</h1>
      <p className="text-muted-foreground">Review pilot station access and versioned sponsor-funded rules. Review does not issue customer credit, accept payment or authorize dispensing.</p>
    </header>
    {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">{error}</p>}
    {feedback && <p role="status" className="rounded-lg border p-3">{feedback}</p>}
    <section className="rounded-xl border p-4 sm:p-6 space-y-4" aria-labelledby="station-heading">
      <h2 id="station-heading" className="text-lg font-semibold">Station decisions</h2>
      <p className="text-sm text-muted-foreground">Only active, verified locations can be enabled. Suspending a station removes operator scope immediately.</p>
      {field('reason', 'Reason for each station, assignment or rule decision')}
      {stations.isPending ? <p role="status">Loading stations…</p> : stations.isError ? <p role="alert">Station records are unavailable. <Button variant="outline" onClick={() => { void stations.refetch(); }}>Retry</Button></p> :
        <div className="grid gap-3 md:grid-cols-2">{stations.data?.map(station => <article key={station.stationId} className="rounded-lg border p-4 space-y-3">
          <div><h3 className="font-medium break-words">{station.name}</h3><p className="text-xs text-muted-foreground break-all">{station.stationId}</p></div>
          <p className="text-sm">{station.active && station.verified ? 'Active and verified' : 'Location verification required'} · Refill review: {station.status}</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !station.active || !station.verified || station.status === 'enable'} onClick={() => { void action(`${base}/stations/${encodeURIComponent(station.stationId)}/enable`, 'Station marked eligible for pilot review. No dispensing was enabled.'); }}>Enable scope</Button>
            <Button size="sm" variant="outline" disabled={busy || station.status === 'suspend'} onClick={() => { void action(`${base}/stations/${encodeURIComponent(station.stationId)}/suspend`, 'Station scope suspended.'); }}>Suspend scope</Button></div>
        </article>)}</div>}
    </section>
    <section className="rounded-xl border p-4 sm:p-6 space-y-4" aria-labelledby="operator-heading">
      <h2 id="operator-heading" className="text-lg font-semibold">Operator station assignment</h2>
      <p className="text-sm text-muted-foreground">Enter the team member ID from User Management. Assignments are checked against the live team role on every request and do not permit dispensing.</p>
      <div className="grid gap-4 sm:grid-cols-2">{stationPicker('operatorStationId', 'Station')}{field('operatorId', 'Team member ID')}</div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { void action(`${base}/stations/${encodeURIComponent(values.operatorStationId ?? '')}/operators/${encodeURIComponent(values.operatorId ?? '')}/grant`, 'Operator scope recorded. No dispense permission was issued.'); }}>Assign station</Button>
        <Button variant="outline" disabled={busy} onClick={() => { void action(`${base}/stations/${encodeURIComponent(values.operatorStationId ?? '')}/operators/${encodeURIComponent(values.operatorId ?? '')}/revoke`, 'Operator scope revoked.'); }}>Revoke assignment</Button></div>
    </section>
    <section className="rounded-xl border p-4 sm:p-6 space-y-4" aria-labelledby="campaign-heading">
      <h2 id="campaign-heading" className="text-lg font-semibold">Propose sponsor-funded campaign version</h2>
      <p className="text-sm text-muted-foreground">Each version is immutable. Enter 0 only for a verified zero cost; leave unknown costs blank. A different administrator must review complete, funded terms. This is a definition, not a customer offer.</p>
      <form onSubmit={proposal} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {field('campaignKey', 'Campaign key')}{field('version', 'Version', 'number')}{stationPicker('stationId', 'Verified station')}
        {field('maxGrants', 'Maximum grants', 'number')}{field('pricingVersion', 'Pricing evidence version')}{field('volume', 'Credit per grant (litres)')}
        {field('sponsor', 'Sponsor funding per grant (KES)')}{field('startsAt', 'Start', 'datetime-local')}{field('endsAt', 'End', 'datetime-local')}
        {refillCostNames.map(name => field(name, costLabels[name]))}
      </div><Button type="submit" disabled={busy}>Record version for review</Button></form>
    </section>
    <section className="rounded-xl border p-4 sm:p-6 space-y-4" aria-labelledby="rules-heading"><h2 id="rules-heading" className="text-lg font-semibold">Version review</h2>
      {rules.isPending ? <p role="status">Loading rules…</p> : rules.isError ? <p role="alert">Rule records are unavailable. <Button variant="outline" onClick={() => { void rules.refetch(); }}>Retry</Button></p> : !rules.data?.length ? <p>No rules proposed yet.</p> :
        <div className="grid gap-3 md:grid-cols-2">{rules.data.map(rule => <article key={rule.id} className="rounded-lg border p-4 space-y-2">
          <h3 className="font-medium">{rule.campaignKey} · version {rule.version}</h3>
          <p className="text-sm break-words">Station {rule.stationId} · {Number(rule.creditMl) / 1000} L per grant · max {rule.maxGrants} grants</p>
          <p className="text-sm">Status: {rule.status}. Proposed by {rule.proposedBy}.</p>
          <p className="text-xs text-muted-foreground">{new Date(rule.startsAt).toLocaleString()} – {new Date(rule.endsAt).toLocaleString()}</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || rule.status !== 'proposed'} onClick={() => { void action(`${base}/rules/${rule.id}/approve`, 'Rule independently reviewed. No credit or refill was activated.'); }}>Review version</Button>
            <Button size="sm" variant="outline" disabled={busy || rule.status === 'suspended'} onClick={() => { void action(`${base}/rules/${rule.id}/suspend`, 'Rule version suspended.'); }}>Suspend version</Button></div>
        </article>)}</div>}
    </section>
  </div>;
}