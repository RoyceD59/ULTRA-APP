import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import { RefillActivationControls, RefillGovernanceGate } from './RefillActivationControls';

vi.mock('@/lib/team-auth', () => ({
  getTeamUser: () => ({ id: 'activation-test-admin' }),
  isTeamAdmin: () => true,
  getAuthHeaders: () => ({ Authorization: 'Bearer test-only' }),
}));

describe('admin preview activation controls', () => {
  let saved: { careOverview: boolean; refillGovernance: boolean };
  let failSave: boolean;
  let failLoad: boolean;
  let calls: { method: string; data?: unknown }[];
  let client: QueryClient;
  beforeEach(() => {
    saved = { careOverview: false, refillGovernance: false };
    failSave = false; failLoad = false; calls = [];
    setBaseUrl(null); setAuthTokenGetter(() => 'test-only');
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET';
      const data = options?.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ method, data });
      const failed = method === 'PATCH' ? failSave : failLoad;
      if (failed) return new Response(JSON.stringify({ error: 'Settings unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      if (method === 'PATCH') saved = { ...saved, ...data };
      return new Response(JSON.stringify(saved), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); setAuthTokenGetter(null); });
  const mount = (content = <RefillActivationControls />) => render(<QueryClientProvider client={client}>{content}</QueryClientProvider>);

  it('starts off, saves only the clicked switch and persists the server result after remount', async () => {
    const view = mount();
    const care = await screen.findByRole('switch', { name: 'Care Overview' });
    expect(care).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(care);
    await screen.findByText('Care Overview activated.');
    expect(calls.find(call => call.method === 'PATCH')?.data).toEqual({ careOverview: true });
    expect(screen.getByRole('switch', { name: /Station & campaign/ })).toHaveAttribute('aria-checked', 'false');
    view.unmount(); mount();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Care Overview' })).toHaveAttribute('aria-checked', 'true'));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Care Overview' })).toBeEnabled());
    fireEvent.click(screen.getByRole('switch', { name: 'Care Overview' }));
    await screen.findByText('Care Overview deactivated.');
    expect(saved.careOverview).toBe(false);
  });

  it('shows the governance link only after successful activation and gates direct access while off', async () => {
    const view = mount();
    await screen.findByRole('switch', { name: /Station & campaign/ });
    expect(screen.queryByRole('link', { name: /Open station and campaign/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /Station & campaign/ }));
    expect(await screen.findByRole('link', { name: /Open station and campaign/ })).toHaveAttribute('href', '/admin/refill-governance');
    view.unmount(); saved.refillGovernance = false; client.clear();
    mount(<RefillGovernanceGate><p>Governance forms</p></RefillGovernanceGate>);
    await screen.findByText('Governance preview is off');
    expect(screen.queryByText('Governance forms')).not.toBeInTheDocument();
  });

  it('does not optimistically activate on a failed save', async () => {
    mount(); const care = await screen.findByRole('switch', { name: 'Care Overview' });
    failSave = true; fireEvent.click(care);
    await screen.findByRole('alert');
    expect(care).toHaveAttribute('aria-checked', 'false');
    expect(saved.careOverview).toBe(false);
  });

  it('fails closed when settings cannot be read and provides a retry', async () => {
    failLoad = true; mount();
    await screen.findByRole('alert');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    failLoad = false; fireEvent.click(screen.getByRole('button', { name: /Retry activation/ }));
    await screen.findByRole('switch', { name: 'Care Overview' });
  });
});