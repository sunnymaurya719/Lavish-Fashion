import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    createAdminUser,
    deleteAdminUser,
    getCurrentAdmin,
    getPermissionCatalog,
    listAdminUsers,
    listAuditLog,
    setAdminUserStatus,
    updateAdminUser,
    updateAdminUserPermissions
} from '../controllers/adminUserController.js';
import { adminAuth, authorizePermissions } from '../middleware/permissions.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    adminUserCreateSchema,
    adminUserIdParamSchema,
    adminUserPermissionsSchema,
    adminUserStatusSchema,
    adminUserUpdateSchema
} from '../validation/schemas.js';

const adminUserRouter = express.Router();

const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many admin user changes. Try again later.' }
});

// ── Self ───────────────────────────────────────────────────────────────────
adminUserRouter.get('/me', adminAuth, getCurrentAdmin);
adminUserRouter.get('/permissions/catalog', adminAuth, getPermissionCatalog);

// ── Audit log (anyone with users.view can read) ───────────────────────────
adminUserRouter.get('/audit-log', adminAuth, authorizePermissions('users.view'), listAuditLog);

// ── User management ────────────────────────────────────────────────────────
adminUserRouter.get('/', adminAuth, authorizePermissions('users.view'), listAdminUsers);

adminUserRouter.post(
    '/',
    adminAuth,
    authorizePermissions('users.create'),
    writeLimiter,
    validateRequest(adminUserCreateSchema),
    createAdminUser
);

adminUserRouter.put(
    '/:id',
    adminAuth,
    authorizePermissions('users.update'),
    writeLimiter,
    validateRequest(adminUserIdParamSchema, 'params'),
    validateRequest(adminUserUpdateSchema),
    updateAdminUser
);

adminUserRouter.patch(
    '/:id/permissions',
    adminAuth,
    authorizePermissions('users.assign_permissions'),
    writeLimiter,
    validateRequest(adminUserIdParamSchema, 'params'),
    validateRequest(adminUserPermissionsSchema),
    updateAdminUserPermissions
);

adminUserRouter.patch(
    '/:id/status',
    adminAuth,
    authorizePermissions('users.update'),
    writeLimiter,
    validateRequest(adminUserIdParamSchema, 'params'),
    validateRequest(adminUserStatusSchema),
    setAdminUserStatus
);

adminUserRouter.delete(
    '/:id',
    adminAuth,
    authorizePermissions('users.delete'),
    writeLimiter,
    validateRequest(adminUserIdParamSchema, 'params'),
    deleteAdminUser
);

export default adminUserRouter;
