import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyState from '../EmptyState';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No data" description="Try a wider filter." />);
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('Try a wider filter.')).toBeInTheDocument();
  });

  it('renders the action slot', () => {
    render(<EmptyState title="No data" action={<button type="button">Reset</button>} />);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });
});
