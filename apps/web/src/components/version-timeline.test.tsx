// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VersionTimeline } from '@/components/version-timeline';
import type { VersionTimelineEntry } from '@/components/version-timeline';

function version(
  versionNumber: number,
  overrides: Partial<VersionTimelineEntry> = {},
): VersionTimelineEntry {
  return {
    id: `v${versionNumber}`,
    versionNumber,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    fileCount: 2,
    message: null,
    isRestore: false,
    ...overrides,
  };
}

function renderTimeline(props: Partial<React.ComponentProps<typeof VersionTimeline>> = {}) {
  const onSelectVersion = vi.fn();
  const onRestoreVersion = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <VersionTimeline
      versions={[version(1), version(2), version(3)]}
      currentVersion={3}
      selectedVersion={3}
      onSelectVersion={onSelectVersion}
      onRestoreVersion={onRestoreVersion}
      {...props}
    />,
  );
  return { onSelectVersion, onRestoreVersion, view };
}

describe('VersionTimeline', () => {
  it('renders every version so none of the history is unreachable', () => {
    const versions = Array.from({ length: 40 }, (_, index) => version(index + 1));

    renderTimeline({ versions, currentVersion: 40, selectedVersion: 40 });

    expect(screen.getAllByRole('button', { name: /^Version \d+/ })).toHaveLength(40);
  });

  it('selects a version when its dot is clicked', async () => {
    const user = userEvent.setup();
    const { onSelectVersion } = renderTimeline();

    await user.click(screen.getByRole('button', { name: 'Version 2' }));

    expect(onSelectVersion).toHaveBeenCalledWith(2);
  });

  it('restores the inspected version from a control that needs no hover', async () => {
    const user = userEvent.setup();
    const { onRestoreVersion } = renderTimeline({ selectedVersion: 2 });

    expect(screen.getByText('Viewing v2 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore v2' }));

    expect(onRestoreVersion).toHaveBeenCalledWith(2);
  });

  it('surfaces a failed restore as an alert', async () => {
    const user = userEvent.setup();
    const onRestoreVersion = vi.fn().mockRejectedValue(new Error('generation in progress'));

    renderTimeline({ selectedVersion: 1, onRestoreVersion });
    await user.click(screen.getByRole('button', { name: 'Restore v1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not restore version 1');
  });

  it('does not leave the restore error on another version', async () => {
    const user = userEvent.setup();
    const onRestoreVersion = vi.fn().mockRejectedValue(new Error('generation in progress'));
    const { view } = renderTimeline({ selectedVersion: 1, onRestoreVersion });

    await user.click(screen.getByRole('button', { name: 'Restore v1' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    view.rerender(
      <VersionTimeline
        versions={[version(1), version(2), version(3)]}
        currentVersion={3}
        selectedVersion={2}
        onSelectVersion={vi.fn()}
        onRestoreVersion={onRestoreVersion}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('marks restore points and the inspected version for assistive tech', () => {
    renderTimeline({
      versions: [version(1), version(2, { isRestore: true, message: 'Restored version 1' })],
      currentVersion: 2,
      selectedVersion: 2,
    });

    expect(screen.getByRole('button', { name: 'Version 1' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Version 2 (restore point), current version' }),
    ).toHaveAttribute('aria-current', 'true');
  });
});
