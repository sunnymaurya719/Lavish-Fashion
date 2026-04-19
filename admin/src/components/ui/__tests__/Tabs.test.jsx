import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Tabs from '../Tabs';

describe('Tabs', () => {
  const tabs = [
    { id: 'all', label: 'All', count: 12 },
    { id: 'live', label: 'Live', count: 3 },
    { id: 'paused', label: 'Paused', count: 1 },
  ];

  it('renders each tab with its count', () => {
    render(<Tabs tabs={tabs} value="all" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /all/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /live/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('calls onChange when a tab is clicked', async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: /live/i }));
    expect(onChange).toHaveBeenCalledWith('live');
  });

  it('navigates with arrow keys', async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="all" onChange={onChange} />);
    const allTab = screen.getByRole('tab', { name: /all/i });
    allTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('live');
  });
});
