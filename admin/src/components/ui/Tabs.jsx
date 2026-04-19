import React, { useEffect, useId, useState } from 'react';

/**
 * Accessible tab control. Optionally syncs the active tab with the URL query
 * via a controlled `value` / `onChange`.
 *
 * Replaces ad-hoc filter strips like the segment switcher in Customers.jsx.
 *
 * tabs shape:
 *   { id: 'all', label: 'All', count?: 12, disabled?: false }
 */
const Tabs = ({
  tabs = [],
  value,
  defaultValue,
  onChange,
  ariaLabel = 'Tabs',
  size = 'md',
  className = '',
}) => {
  const generatedId = useId();
  const [internalValue, setInternalValue] = useState(defaultValue ?? tabs[0]?.id);
  const activeId = value ?? internalValue;

  useEffect(() => {
    if (value === undefined && tabs.length > 0 && !tabs.some((tab) => tab.id === internalValue)) {
      setInternalValue(tabs[0].id);
    }
  }, [tabs, value, internalValue]);

  const handleSelect = (id) => {
    if (value === undefined) setInternalValue(id);
    onChange?.(id);
  };

  const handleKeyDown = (event, index) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    let next = (index + direction + tabs.length) % tabs.length;
    while (tabs[next]?.disabled && next !== index) {
      next = (next + direction + tabs.length) % tabs.length;
    }
    handleSelect(tabs[next].id);
    document.getElementById(`${generatedId}-tab-${tabs[next].id}`)?.focus();
  };

  const padding = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <div
      role='tablist'
      aria-label={ariaLabel}
      className={`inline-flex flex-wrap items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-1 ${className}`}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            id={`${generatedId}-tab-${tab.id}`}
            role='tab'
            type='button'
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => handleSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`${padding} flex items-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              isActive
                ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            } ui-focus-ring`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count !== null ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  isActive ? 'bg-slate-900 text-white' : 'bg-white text-[var(--color-text-muted)]'
                }`}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};

export default Tabs;
