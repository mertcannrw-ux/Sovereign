// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingPanel } from '@/components/settings/billing-panel';

const mocks = vi.hoisted(() => ({
  billing: {} as Record<string, unknown>,
  checkout: vi.fn(),
  registerInterest: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    organizations: {
      list: {
        useQuery: () => ({ data: [{ id: 'org-1', name: 'Workspace' }], isLoading: false }),
      },
    },
    billing: {
      getPlan: { useQuery: () => ({ data: mocks.billing, isLoading: false }) },
      createCheckoutSession: {
        useMutation: () => ({ mutateAsync: mocks.checkout, isPending: false }),
      },
      createPortalSession: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      registerInterest: { useMutation: () => ({ mutate: mocks.registerInterest }) },
    },
  },
}));

function billing(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'free',
    limits: { activeProjects: 3 },
    status: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasSubscription: false,
    hasBillingAccount: false,
    canManage: true,
    billingConfigured: true,
    paidPlansAvailable: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.billing = billing();
  mocks.checkout.mockResolvedValue({ url: 'https://checkout.stripe.test' });
});

describe('BillingPanel before paid plans launch', () => {
  it('labels the paid plans as coming soon without opening anything', () => {
    render(<BillingPanel />);
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.registerInterest).not.toHaveBeenCalled();
  });

  it('records interest and shows the coming soon window when subscribe is pressed', async () => {
    render(<BillingPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));

    expect(mocks.registerInterest).toHaveBeenCalledWith({ plan: 'pro' });
    expect(mocks.checkout).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Pro is coming soon');

    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets any member register interest, not only owners and admins', async () => {
    mocks.billing = billing({ canManage: false, billingConfigured: false });
    render(<BillingPanel />);
    const button = screen.getByRole('button', { name: 'Upgrade to Business' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(mocks.registerInterest).toHaveBeenCalledWith({ plan: 'business' });
    expect(screen.queryByText(/Only workspace owners/)).not.toBeInTheDocument();
  });
});

describe('BillingPanel after paid plans launch', () => {
  it('starts checkout instead of recording interest', async () => {
    mocks.billing = billing({ paidPlansAvailable: true });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, search: '' });
    render(<BillingPanel />);
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    expect(mocks.checkout).toHaveBeenCalledWith({ organizationId: 'org-1', plan: 'pro' });
    expect(mocks.registerInterest).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
