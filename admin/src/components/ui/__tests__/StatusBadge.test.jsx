import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../StatusBadge';

describe('StatusBadge', () => {
  it('renders the formatted status label', () => {
    render(<StatusBadge status="low_stock" />);
    expect(screen.getByText('Low Stock')).toBeInTheDocument();
  });

  it('falls back to neutral tone for unknown status', () => {
    const { container } = render(<StatusBadge status="banana" />);
    const badge = container.querySelector('span');
    expect(badge.className).toMatch(/bg-slate-50/);
  });

  it('renders provided children instead of label', () => {
    render(
      <StatusBadge status="active" tone="success">
        Custom label
      </StatusBadge>,
    );
    expect(screen.getByText('Custom label')).toBeInTheDocument();
  });
});
