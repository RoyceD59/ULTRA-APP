import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImpactDashboard } from './impact';

vi.mock('@/lib/team-auth', () => ({
  getTeamToken: () => null,
  isTeamAdmin: () => false,
  isTeamAuthenticated: () => false,
  canView: () => false,
  canEdit: () => false,
}));

const impactData = {
  snapshotId: 'a'.repeat(64),
  calculatedAt: '2026-10-05T00:00:00.000Z',
  adjustmentRevision: 1,
  maxAgeSeconds: 60,
  totalUsers: 2,
  litresFiltered: 300,
  plasticsAvoided: 600,
  autoStats: { totalUsers: 0, litresFiltered: 0 },
  offlineStats: { clientCount: 2, litresFiltered: 300 },
  override: {
    litresOffset: 0,
    usersOffset: 0,
    lastUpdatedBy: '',
    lastUpdatedAt: '',
  },
  lastUpdated: '2026-09-12T00:00:00.000Z',
};

const clients = [
  {
    id: 1,
    clientRef: 'Client with contacts',
    phone: '+254700123456',
    email: 'client@example.com',
    products: [{ productName: 'Hydra Flux bottle', quantity: 1, litresPerUnit: 150 }],
    saleDate: '2026-09-12',
    notes: '',
    createdAt: '2026-09-12T00:00:00.000Z',
    accountSetupStatus: 'created',
    deliveryChannel: 'email',
    deliveryStatus: 'sent',
  },
  {
    id: 2,
    clientRef: 'Client without contacts',
    phone: null,
    email: null,
    products: [{ productName: 'Hydra Flux bottle', quantity: 1, litresPerUnit: 150 }],
    saleDate: '2026-09-12',
    notes: '',
    createdAt: '2026-09-12T00:00:00.000Z',
    accountSetupStatus: 'conflict',
    deliveryChannel: null,
    deliveryStatus: 'pending',
    conflictReason: 'Email and phone identify different accounts',
  },
];

describe('ImpactDashboard offline client contact actions', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/uc/impact')) {
        return new Response(JSON.stringify(impactData), { status: 200 });
      }
      if (url.endsWith('/api/uc/offline-clients')) {
        return new Response(JSON.stringify({ clients }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  it('keeps failed and offline snapshots explicitly stale and provides a retry without overwriting an open adjustment', async () => {
    render(<ImpactDashboard token="test-token" onSignOut={vi.fn()} />);
    await screen.findByText(/Current global snapshot/);
    fireEvent.click(screen.getByText('Legacy Bulk Adjustment'));
    const litres = screen.getByLabelText('Additional Litres (bulk)');
    fireEvent.change(litres, { target: { value: '1234' } });
    global.fetch = vi.fn(async () => new Response('{}', { status: 503 }));
    fireEvent(window, new Event('focus'));
    await screen.findByText(/STALE — last-known figures/);
    expect(litres).toHaveValue(1234);
    global.fetch = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith('/api/uc/impact')
      ? { ...impactData, adjustmentRevision: 2, override: { ...impactData.override, litresOffset: 500 } }
      : { clients }), { status: 200 }));
    fireEvent(window, new Event('online'));
    await screen.findByText(/Current global snapshot/);
    expect(litres).toHaveValue(1234);
    fireEvent.click(screen.getByRole('button', { name: 'Save bulk adjustment' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/uc/impact/override'),
      expect.objectContaining({ body: JSON.stringify({ litresOffset: 1234, usersOffset: 0, expectedRevision: 1 }) })));
  });

  it('drops late refreshes instead of replacing a more recently requested snapshot', async () => {
    render(<ImpactDashboard token="test-token" onSignOut={vi.fn()} />);
    await screen.findByText(/Current global snapshot/);
    let resolveOld!: (response: Response) => void;
    let calls = 0;
    global.fetch = vi.fn(() => {
      calls++;
      if (calls === 1) return new Promise<Response>(resolve => { resolveOld = resolve; });
      return Promise.resolve(new Response(JSON.stringify({ ...impactData, snapshotId: 'b'.repeat(64) }), { status: 200 }));
    });
    fireEvent(window, new Event('focus'));
    fireEvent(window, new Event('online'));
    await screen.findByText(/Snapshot bbbbbbbbbbbb/);
    resolveOld(new Response(JSON.stringify(impactData), { status: 200 }));
    await waitFor(() => expect(screen.queryByText(/Snapshot aaaaaaaaaaaa/)).toBeNull());
  });

  it('renders call and email links, while missing values remain unlinked dashes', async () => {
    render(<ImpactDashboard token="test-token" onSignOut={vi.fn()} />);

    const phoneLink = await screen.findByRole('link', { name: '+254700123456' });
    expect(phoneLink).toHaveAttribute('href', 'tel:+254700123456');

    const emailLink = screen.getByRole('link', { name: 'client@example.com' });
    expect(emailLink).toHaveAttribute('href', 'mailto:client@example.com');

    const missingContactRow = screen.getByText('Client without contacts').closest('tr');
    expect(missingContactRow).not.toBeNull();
    expect(within(missingContactRow!).queryAllByRole('link')).toHaveLength(0);
    expect(within(missingContactRow!).getAllByText('—')).toHaveLength(3);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('shows Companion account and credential delivery status for each sale', async () => {
    render(<ImpactDashboard token="test-token" onSignOut={vi.fn()} />);

    expect(await screen.findByText('Account created')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('via email')).toBeInTheDocument();
    expect(screen.getByText('Account conflict')).toBeInTheDocument();
    expect(screen.getByText('Email and phone identify different accounts')).toBeInTheDocument();
  });
});