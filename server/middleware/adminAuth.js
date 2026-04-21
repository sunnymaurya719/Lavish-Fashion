// Backwards-compatible shim. The original `adminAuth` middleware lived here
// and only validated the env-based super admin token. The implementation was
// moved to `./permissions.js` so it can also accept tokens issued to
// database-backed admin/manager/staff users (RBAC). All previous import sites
// continue to work unchanged.
import adminAuth, { authorizePermissions } from './permissions.js';

export { authorizePermissions };
export default adminAuth;