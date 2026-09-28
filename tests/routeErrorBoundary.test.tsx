import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from '@/components/Layout/RouteErrorBoundary';

const BrokenRoute = () => {
  throw new Error('test route failure');
};

describe('RouteErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a broken workflow inside a recoverable fallback', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onBack = vi.fn();

    render(
      <RouteErrorBoundary
        title="Route failed"
        description="The route could not be rendered."
        retryLabel="Retry"
        backLabel="Overview"
        onBack={onBack}
      >
        <BrokenRoute />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole('alert').textContent).toContain('Route failed');
    expect(consoleError).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
