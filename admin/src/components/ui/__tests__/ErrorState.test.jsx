import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorState from '../ErrorState';

describe('ErrorState', () => {
  it('renders title, description, and detail', () => {
    render(
      <ErrorState
        title="Boom"
        description="Things went wrong"
        detail="stack trace"
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Boom')).toBeInTheDocument();
    expect(screen.getByText('Things went wrong')).toBeInTheDocument();
    expect(screen.getByText('stack trace')).toBeInTheDocument();
  });

  it('invokes onRetry when the retry button is pressed', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} retryLabel="Try again" />);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when no handler is given', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
