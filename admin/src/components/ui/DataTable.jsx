import React from 'react';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import LoadingState from './LoadingState';

/**
 * Lightweight, column-driven table with sticky header and selection support.
 * NOT virtualized in this iteration — virtualization is a Phase 3 follow-up
 * once react-window is added. The API is shaped to allow swapping the body
 * later without touching callers.
 *
 * column shape:
 *   {
 *     key: 'name',
 *     header: 'Name',
 *     align: 'left' | 'right' | 'center',
 *     width: '160px',         // optional column width
 *     sortable: true,         // enables sort callback
 *     headerClassName: '',
 *     cellClassName: '',
 *     render: (row, ctx) => ReactNode  // overrides accessing row[key]
 *   }
 */

const alignClass = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

const SortIndicator = ({ direction }) => {
  if (!direction) {
    return (
      <span className='ml-1 inline-block text-[var(--color-text-subtle)]' aria-hidden='true'>
        ↕
      </span>
    );
  }
  return (
    <span className='ml-1 inline-block text-[var(--color-text-primary)]' aria-hidden='true'>
      {direction === 'asc' ? '↑' : '↓'}
    </span>
  );
};

const DataTable = ({
  columns = [],
  rows = [],
  rowKey = 'id',
  loading = false,
  error = null,
  onRetry,
  emptyTitle = 'Nothing to show',
  emptyDescription = 'No records match your filters.',
  emptyAction,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  onRowClick,
  isRowActive,
  sortKey,
  sortDirection,
  onSortChange,
  stickyHeader = true,
  className = '',
  density = 'comfortable',
}) => {
  const totalColumns = columns.length + (selectable ? 1 : 0);
  const cellPadding = density === 'compact' ? 'px-3 py-2' : 'px-4 py-3';
  const headerPadding = density === 'compact' ? 'px-3 py-2.5' : 'px-4 py-3';

  const getRowKey = (row, index) => {
    if (typeof rowKey === 'function') return rowKey(row, index);
    return row?.[rowKey] ?? index;
  };

  const allSelected =
    selectable && rows.length > 0 && rows.every((row, idx) => selectedIds.includes(getRowKey(row, idx)));
  const someSelected =
    selectable && !allSelected && rows.some((row, idx) => selectedIds.includes(getRowKey(row, idx)));

  const toggleAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange([]);
      return;
    }
    onSelectionChange(rows.map((row, idx) => getRowKey(row, idx)));
  };

  const toggleRow = (id) => {
    if (!onSelectionChange) return;
    const next = selectedIds.includes(id)
      ? selectedIds.filter((value) => value !== id)
      : [...selectedIds, id];
    onSelectionChange(next);
  };

  const handleHeaderClick = (column) => {
    if (!column.sortable || !onSortChange) return;
    if (sortKey !== column.key) {
      onSortChange(column.key, 'asc');
      return;
    }
    if (sortDirection === 'asc') {
      onSortChange(column.key, 'desc');
      return;
    }
    onSortChange(null, null);
  };

  return (
    <div
      className={`overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm ${className}`}
    >
      <div className='overflow-x-auto'>
        <table className='w-full border-collapse text-sm'>
          <thead
            className={`bg-[var(--color-surface-muted)] text-left text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-muted)] ${
              stickyHeader ? 'sticky top-0 z-[1]' : ''
            }`}
          >
            <tr>
              {selectable ? (
                <th className={`${headerPadding} w-10`}>
                  <input
                    type='checkbox'
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    aria-label='Select all rows'
                    className='h-4 w-4 rounded border-[var(--color-border-strong)]'
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const isSorted = sortKey === column.key;
                return (
                  <th
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={`${headerPadding} ${alignClass[column.align] || 'text-left'} ${column.headerClassName || ''} ${
                      column.sortable ? 'cursor-pointer select-none hover:text-[var(--color-text-primary)]' : ''
                    }`}
                    onClick={() => handleHeaderClick(column)}
                    aria-sort={
                      isSorted
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : column.sortable
                          ? 'none'
                          : undefined
                    }
                  >
                    {column.header}
                    {column.sortable ? <SortIndicator direction={isSorted ? sortDirection : null} /> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className='divide-y divide-[var(--color-border)] text-[var(--color-text-primary)]'>
            {loading ? (
              <tr>
                <td colSpan={totalColumns} className='p-0'>
                  <LoadingState variant='table' rows={5} columns={Math.max(columns.length, 3)} />
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={totalColumns} className='p-4'>
                  <ErrorState
                    title='Could not load records'
                    description={typeof error === 'string' ? error : error?.message}
                    onRetry={onRetry}
                  />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={totalColumns} className='p-4'>
                  <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => {
                const id = getRowKey(row, rowIndex);
                const isSelected = selectable && selectedIds.includes(id);
                const isActive = typeof isRowActive === 'function' ? isRowActive(row, rowIndex) : false;
                return (
                  <tr
                    key={id}
                    className={`transition ${
                      isActive
                        ? 'bg-blue-50/60'
                        : isSelected
                          ? 'bg-slate-50'
                          : 'hover:bg-[var(--color-surface-muted)]'
                    } ${onRowClick ? 'cursor-pointer' : ''}`}
                    onClick={onRowClick ? (event) => {
                      // Don't fire row click when interacting with checkbox or button
                      const tag = event.target?.tagName;
                      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return;
                      onRowClick(row, rowIndex);
                    } : undefined}
                  >
                    {selectable ? (
                      <td className={`${cellPadding} w-10`}>
                        <input
                          type='checkbox'
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                          aria-label='Select row'
                          className='h-4 w-4 rounded border-[var(--color-border-strong)]'
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`${cellPadding} ${alignClass[column.align] || 'text-left'} ${column.cellClassName || ''}`}
                      >
                        {column.render ? column.render(row, { rowIndex, isSelected }) : row?.[column.key]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DataTable;
