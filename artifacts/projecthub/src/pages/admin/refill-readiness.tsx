import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { refillCostNames, type RefillSimulationResult } from '@workspace/api-zod/refill-readiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAuthHeaders } from '@/lib/team-auth';
import { apiUrl } from '@/lib/api-base';
import { parseFixedUnits } from '@/lib/refill-input';
import { Link } from 'wouter';

type Readiness = {
  phase: string; activationAllowed: false;
  blockers: { id: string; message: string }[];
  flagManifest: { server: string | null; client: string | null; default: false; scope: string }[];
};
const labels = {
  waterPerLitreMinor: 'Water cost per litre', paymentMinor: 'Payment fees',
  deliverySupportMinor: 'Delivery and support', benefitObligationMinor: 'Future benefit obligation', taxMinor: 'Tax',
};
async function request<T>(path: string, body?: unknown): Promise<T> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error('Sign in as an administrator to continue.');
  const response = await fetch(apiUrl(path), { method: body ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(response.status === 401 ? 'Administrator access is required.' : 'The preview is unavailable. Check the inputs and try again.');
  return response.json() as Promise<T>;
}
const money = (minor: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(minor / 100);

export default function RefillReadinessPage() {
  const readiness = useQuery({ queryKey: ['admin', 'refill-readiness'], queryFn: () => request<Readiness>('/api/uc/admin/refill/readiness') });
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RefillSimulationResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = (name: string, label: string, numeric = true) => <div className="space-y-2" key={name}>
    <Label htmlFor={`refill-${name}`}>{label}</Label>
    <Input id={`refill-${name}`} type="text" inputMode={numeric ? 'decimal' : 'text'} value={values[name] ?? ''}
      onChange={event => { setValues(previous => ({ ...previous, [name]: event.target.value })); setResult(null); setError(''); }} disabled={busy} />
  </div>;
  const simulate = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setResult(null); setBusy(true);
    try {
      const costs = Object.fromEntries(refillCostNames.map(name => [name, values[name]?.trim() ? parseFixedUnits(values[name]!, 2) : null]));
      setResult(await request<RefillSimulationResult>('/api/uc/admin/refill/simulate', {
        pricingVersion: values.pricingVersion ?? '', campaignVersion: values.campaignVersion ?? '',
        volumeMl: parseFixedUnits(values.volume ?? '', 3), cashChargeMinor: parseFixedUnits(values.cash ?? '', 2),
        sponsorFundingMinor: parseFixedUnits(values.sponsor ?? '', 2), costs,
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not calculate this preview.'); }
    finally { setBusy(false); }
  };
  return <div className="max-w-5xl mx-auto space-y-8 p-4 sm:p-6">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Care and refill readiness</h1>
      <p className="text-muted-foreground">Review rollout controls and the cost of a proposed refill before committing a campaign.</p></header>
    <section className="rounded-xl border p-5 space-y-4" aria-labelledby="refill-controls-heading">
      <h2 id="refill-controls-heading" className="text-lg font-semibold">Pilot controls</h2>
      <p className="font-medium">Refill, wallet and paid-care transactions are unavailable in this foundation.</p>
      {readiness.isPending ? <p role="status">Loading controls…</p> : readiness.isError ? <div role="alert"><p>We couldn't refresh the rollout controls.</p><Button variant="outline" onClick={() => { void readiness.refetch(); }}>Retry controls</Button></div> : <>
        <ul className="space-y-2 list-disc pl-5 text-sm">{readiness.data?.blockers.map(item => <li key={item.id}>{item.message}</li>)}</ul>
        <p className="text-sm text-muted-foreground">All new switches default off. The care overview links to existing free-member features only.</p>
        {import.meta.env.VITE_UC_REFILL_GOVERNANCE_PREVIEW === 'true' && <Link href="/admin/refill-governance" className="inline-block text-sm underline">Open station and campaign governance →</Link>}
      </>}
    </section>
    <section className="rounded-xl border p-5 space-y-5" aria-labelledby="refill-preview-heading">
      <div className="space-y-2"><h2 id="refill-preview-heading" className="text-lg font-semibold">Refill cost preview</h2>
        <p className="text-sm text-muted-foreground">Scenario only. No balances, prices or campaign rules are saved. Leave an unknown cost blank; use 0 only when that cost has been verified as zero.</p></div>
      <form onSubmit={simulate} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('pricingVersion', 'Proposed pricing version', false)}{field('campaignVersion', 'Proposed campaign version', false)}
          {field('volume', 'Refill volume (litres)')}{field('cash', 'Customer charge (KES)')}{field('sponsor', 'Sponsor funding for this refill (KES)')}
          {refillCostNames.map(name => field(name, `${labels[name]} (KES${name === 'waterPerLitreMinor' ? '/litre' : ''})`))}
        </div>
        <Button type="submit" disabled={busy}>{busy ? 'Calculating…' : 'Calculate preview'}</Button>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </form>
      {result && <div role="status" className="rounded-lg bg-muted p-4 space-y-2">
        {result.status === 'missing_costs' ? <><h3 className="font-semibold">Cost evidence is incomplete</h3><p>Missing: {result.missingCosts.map(name => labels[name as keyof typeof labels]).join(', ')}. Contribution cannot be calculated.</p></> : <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><dt>Total cost</dt><dd className="text-xl font-semibold">{money(result.totalCostMinor!)}</dd></div>
          <div><dt>Scenario contribution</dt><dd className="text-xl font-semibold">{money(result.contributionMinor!)}</dd></div>
        </dl>}
        <p className="text-sm">Promotional refills contribute KES 0 to MRR. Wallet top-ups are not earned refill revenue.</p>
        <p className="text-sm">This preview does not approve activation or establish accounting treatment.</p>
      </div>}
    </section>
  </div>;
}
