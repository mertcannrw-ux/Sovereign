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
    realms: {
      list: {
        useQuery: () => ({
          data: [{ id: 'realm-1', name: 'Personal', type: 'PERSONAL', role: 'OWNER' }],
          isLoading: false,
        }),
      },
    },
    billing: {
      getPlan: { useQuery: () => ({ data: mocks.billing, isLoading: false }) },
      createCheckoutSession: {
        useMutation: () => ({ mutateAsync: mocks.checkout, isPending: false }),
      },
      createPortalSession: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      registerInterest: {
        useMutation: () => ({ mutate: (input: unknown) => mocks.registerInterest(input) }),
      },
    },
  },
}));

function billing(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'free',
    limits: { activeProjects: 3 },
    activeProjects: 1,
    interestedPlans: [],
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
  it('labels both paid plans as coming soon', () => {
    render(<BillingPanel />);
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Notify me' })).toHaveLength(2);
    expect(mocks.registerInterest).not.toHaveBeenCalled();
  });

  it('records interest and confirms it on the plan row', async () => {
    render(<BillingPanel />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Notify me' })[0]!);

    expect(mocks.registerInterest).toHaveBeenCalledWith({ plan: 'pro' });
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /You'll be notified/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Notify me' })).toBeEnabled();
  });

  it('restores the notified state saved on the server', () => {
    mocks.billing = billing({ interestedPlans: ['pro'] });
    render(<BillingPanel />);
    expect(screen.getByRole('button', { name: /You'll be notified/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Notify me' })).toBeEnabled();
  });

  it('lets any member register interest, not only owners and admins', async () => {
    mocks.billing = billing({ canManage: false, billingConfigured: false });
    render(<BillingPanel />);
    const button = screen.getAllByRole('button', { name: 'Notify me' })[1]!;
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(mocks.registerInterest).toHaveBeenCalledWith({ plan: 'business' });
    expect(screen.queryByText(/Only workspace owners/)).not.toBeInTheDocument();
  });
});

describe('BillingPanel usage meter', () => {
  it('shows the count and meter below the limit without a warning', () => {
    render(<BillingPanel />);
    const meter = screen.getByRole('progressbar', { name: 'Active projects' });
    expect(meter).toHaveAttribute('aria-valuenow', '1');
    expect(meter).toHaveAttribute('aria-valuemax', '3');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.queryByText(/Limit reached/)).not.toBeInTheDocument();
  });

  it('warns at the limit and links to the projects list', () => {
    mocks.billing = billing({ activeProjects: 3 });
    render(<BillingPanel />);
    const meter = screen.getByRole('progressbar', { name: 'Active projects' });
    expect(meter).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Archive a project' });
    expect(link).toHaveAttribute('href', '/dashboard');
    expect(link.closest('p')).toHaveTextContent('Limit reached.');
  });
});

describe('BillingPanel after paid plans launch', () => {
  it('starts checkout and keeps both brands outlined below the limit', async () => {
    mocks.billing = billing({ paidPlansAvailable: true, activeProjects: 1 });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, search: '' });
    render(<BillingPanel />);
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();

    const pro = screen.getByRole('button', { name: 'Upgrade to Pro' });
    const business = screen.getByRole('button', { name: 'Upgrade to Business' });
    expect(pro).not.toHaveClass('bg-primary');
    expect(business).not.toHaveClass('bg-primary');

    await userEvent.click(pro);
    expect(mocks.checkout).toHaveBeenCalledWith({ realmId: 'realm-1', plan: 'pro' });
    expect(mocks.registerInterest).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('makes only Pro primary at the limit', () => {
    mocks.billing = billing({ paidPlansAvailable: true, activeProjects: 3 });
    render(<BillingPanel />);
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'Upgrade to Business' })).not.toHaveClass(
      'bg-primary',
    );
  });
});
