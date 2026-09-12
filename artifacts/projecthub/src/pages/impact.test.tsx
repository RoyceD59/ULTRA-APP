import { render, screen, waitFor, within } from '@testing-library/react';
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
});