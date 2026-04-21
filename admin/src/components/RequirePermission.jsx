import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../store/authStore';

/**
 * Route-level access guard. Renders children only if the current admin holds
 * the required permission(s); otherwise redirects to /forbidden so the user
 * sees an explicit explanation rather than a silent redirect to dashboard.
 *
 * <RequirePermission permission='users.view'>
 *   <UsersPage />
 * </RequirePermission>
 *
 * <RequirePermission anyOf={['orders.view','orders.update']}>
 *   ...
 * </RequirePermission>
 */
const RequirePermission = ({ permission, allOf, anyOf, children, fallbackTo = '/forbidden' }) => {
  const location = useLocation();
  const { isAuthenticated, isLoadingUser, user, hasPermission, hasAllPermissions, hasAnyPermission } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to='/' replace state={{ from: location.pathname }} />;
  }

  // Wait until the profile (and therefore the permission set) has loaded
  // before evaluating; otherwise the very first render would always 403.
  if (isLoadingUser || !user) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-600' />
      </div>
    );
  }

  let allowed = true;
  if (Array.isArray(allOf) && allOf.length > 0) allowed = hasAllPermissions(allOf);
  else if (Array.isArray(anyOf) && anyOf.length > 0) allowed = hasAnyPermission(anyOf);
  else if (permission) allowed = hasPermission(permission);

  if (!allowed) {
    return <Navigate to={fallbackTo} replace state={{ from: location.pathname, required: permission || allOf || anyOf }} />;
  }

  return children;
};

export default RequirePermission;
