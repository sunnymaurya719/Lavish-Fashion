/**
 * Barrel for shared admin hooks (Phase 1 of ADMIN_UI_OPTIMIZATION_PLAN §1.2).
 */
export { default as useAdminQuery, invalidateAdminQuery, clearAdminQueryCache, peekAdminQueryCache } from './useAdminQuery';
export { default as useAdminMutation } from './useAdminMutation';
export { default as useDebouncedValue } from './useDebouncedValue';
export { default as useKeyboardShortcut } from './useKeyboardShortcut';
export { default as useTableSelection } from './useTableSelection';
export { default as usePersistedState } from './usePersistedState';
