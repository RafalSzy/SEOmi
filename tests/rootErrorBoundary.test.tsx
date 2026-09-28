import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootErrorBoundary } from '@/components/Layout/RootErrorBoundary';

describe('RootErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps an initialization failure visible and recovers after retry', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;

    const FailsDuringInitialization = () => {
      if (shouldThrow) {
        throw new Error('initialization failure');
      }
      return <p>Application recovered</p>;
    };

    render(
      <RootErrorBoundary
        title="Application failed"
        description="The application could not be initialized."
        retryLabel="Retry"
        reloadLabel="Reload"
      >
        <FailsDuringInitialization />
      </RootErrorBoundary>,
    );

    expect(screen.getByRole('alert').textContent).toContain('Application failed');
    expect(screen.getByText('initialization failure')).toBeTruthy();
    expect(consoleError).toHaveBeenCalledWith(
      'root-render-failed',
      expect.any(Error),
      expect.any(String),
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Application recovered')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
