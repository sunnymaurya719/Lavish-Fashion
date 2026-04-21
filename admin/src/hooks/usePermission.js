import { useAuth } from '../store/authStore';

/**
 * Reusable permission hook.
 *
 *   const canEdit = usePermission('orders.update');
 *   const canEdit = usePermission(['orders.update', 'orders.refund']);     // ALL
 *   const canEdit = usePermission(['orders.update', 'orders.refund'], 'any'); // ANY
 */
const usePermission = (permission, mode = 'all') => {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = useAuth();

  if (!permission) return true;

  if (Array.isArray(permission)) {
    if (permission.length === 0) return true;
    return mode === 'any' ? hasAnyPermission(permission) : hasAllPermissions(permission);
  }

  return hasPermission(permission);
};

export default usePermission;
export { usePermission };
