import jwt from 'jsonwebtoken';
import {
    PERMISSION_WILDCARD,
    userHasAllPermissions,
    userHasAnyPermission,
    userHasPermission
} from '../config/permissions.js';

const extractToken = (req) => {
    const headerToken = req.headers.token;
    const authHeader = req.headers.authorization;

    if (headerToken) return headerToken;

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }

    return null;
};

/**
 * Decode the admin JWT and attach a normalized actor to req.admin.
 *
 * Two token shapes are supported (both signed with JWT_SECRET):
 *
 *   1. Legacy super admin (env-based ADMIN_EMAIL):
 *        { role: 'admin', email }
 *      → granted PERMISSION_WILDCARD ('*').
 *
 *   2. Database admin/manager/staff:
 *        { id, role, email, permissions }
 *      → permissions enforced as embedded in the token.
 *
 * Any non-admin role (customer) is rejected.
 */
const adminAuth = (req, res, next) => {
    try {
        const token = extractToken(req);
        if (!token) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const role = String(decoded?.role || '');

        if (!['admin', 'manager', 'staff'].includes(role)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // Legacy env-based super admin path. We additionally require the
        // email to match ADMIN_EMAIL so a stolen "role:admin" token from
        // another deployment cannot be replayed here.
        const isLegacySuperAdmin =
            !decoded.id &&
            role === 'admin' &&
            decoded.email &&
            decoded.email === process.env.ADMIN_EMAIL;

        if (isLegacySuperAdmin) {
            req.admin = {
                id: null,
                email: decoded.email,
                role: 'admin',
                permissions: [PERMISSION_WILDCARD],
                isSuperAdmin: true
            };
            return next();
        }

        if (!decoded.id) {
            return res.status(401).json({ success: false, message: 'Invalid admin token' });
        }

        const permissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];

        req.admin = {
            id: String(decoded.id),
            email: String(decoded.email || '').toLowerCase(),
            role,
            permissions,
            isSuperAdmin: permissions.includes(PERMISSION_WILDCARD)
        };

        return next();
    } catch (error) {
        req.log?.warn({ err: error }, 'Error in admin auth middleware');
        return res.status(401).json({ success: false, message: 'Invalid or expired admin token' });
    }
};

/**
 * Build a middleware that enforces required permissions against req.admin.
 * Must be used AFTER adminAuth.
 *
 *   authorizePermissions('orders.view')                 // single
 *   authorizePermissions('orders.view', 'orders.update')// ALL of these
 *   authorizePermissions(['orders.view','orders.update'], { mode: 'any' })
 */
const authorizePermissions = (...args) => {
    let required = [];
    let mode = 'all';

    for (const arg of args) {
        if (Array.isArray(arg)) {
            required.push(...arg);
        } else if (arg && typeof arg === 'object') {
            if (arg.mode === 'any' || arg.mode === 'all') mode = arg.mode;
            if (Array.isArray(arg.permissions)) required.push(...arg.permissions);
        } else if (typeof arg === 'string') {
            required.push(arg);
        }
    }

    required = required.map((p) => String(p || '').trim()).filter(Boolean);

    return (req, res, next) => {
        if (!req.admin) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        if (required.length === 0) return next();

        const grants = req.admin.permissions || [];
        const ok =
            mode === 'any'
                ? userHasAnyPermission(grants, required)
                : userHasAllPermissions(grants, required);

        if (!ok) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to perform this action',
                required,
                mode
            });
        }

        return next();
    };
};

export { adminAuth, authorizePermissions, extractToken, userHasPermission };
export default adminAuth;
