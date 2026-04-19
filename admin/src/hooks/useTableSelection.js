import { useCallback, useMemo, useState } from 'react';

/**
 * Multi-row selection state for tables that support bulk actions.
 *
 * Returns:
 *   selectedIds: Array<string|number>
 *   isSelected(id): boolean
 *   toggle(id): void
 *   selectAll(): void
 *   clear(): void
 *   setSelectedIds(ids): void
 *
 * Auto-prunes ids that are no longer present in `rows`.
 */
const useTableSelection = (rows = [], idKey = 'id') => {
  const [selectedIds, setSelectedIds] = useState([]);

  const allIds = useMemo(() => {
    if (typeof idKey === 'function') return rows.map((row, idx) => idKey(row, idx));
    return rows.map((row) => row?.[idKey]).filter((id) => id !== undefined && id !== null);
  }, [rows, idKey]);

  const validSelected = useMemo(() => {
    if (selectedIds.length === 0) return selectedIds;
    const allIdSet = new Set(allIds);
    return selectedIds.filter((id) => allIdSet.has(id));
  }, [selectedIds, allIds]);

  const isSelected = useCallback(
    (id) => validSelected.includes(id),
    [validSelected]
  );

  const toggle = useCallback((id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(allIds);
  }, [allIds]);

  const clear = useCallback(() => setSelectedIds([]), []);

  return {
    selectedIds: validSelected,
    selectedCount: validSelected.length,
    isSelected,
    toggle,
    selectAll,
    clear,
    setSelectedIds,
    allCount: allIds.length,
    isAllSelected: allIds.length > 0 && validSelected.length === allIds.length,
  };
};

export default useTableSelection;
