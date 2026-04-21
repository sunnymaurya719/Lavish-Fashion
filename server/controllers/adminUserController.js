import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import userModel from '../models/userModel.js';
import auditLogModel from '../models/auditLogModel.js';
import {
    PERMISSION_WILDCARD,
    ALL_PERMISSIONS,
    PERMISSION_MODULES,
    ROLE_PERMISSION_TEMPLATES,
    sanitizePermissions,
    getRoleTemplate
} from '../config/permissions.js';

const ADMIN_TOKEN_TTL = '8h';

const buildAdminTokenPayload = (user) => ({
    id: String(user._id),
    role: user.role,
    email: user.email,
    permissions: Array.isArray(user.permissions) ? user.permissions : []
});

const buildLegacySuperAdminPayload = (email) => ({
    role: 'admin',
    email
});

const signAdminToken = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ADMIN_TOKEN_TTL });

const buildAdminProfile = (user) => ({
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    isActive: user.isActive !== false,
    isSuperAdmin: Array.isArray(user.permissions) && user.permissions.includes(PERMISSION_WILDCARD),
    createdBy: user.createdBy ? String(user.createdBy) : null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null
});

const buildLegacySuperAdminProfile = (email) => ({
    id: null,
    name: 'Super Admin',
    email,
    role: 'admin',
    permissions: [PERMISSION_WILDCARD],
    isActive: true,
    isSuperAdmin: true,
    createdBy: null,
    createdAt: null,
    updatedAt: null,
    lastLoginAt: null
});

/**
 * Unified admin login.
 *
 * 1. If email matches process.env.ADMIN_EMAIL → check env password.
 *    Issues a "legacy super admin" token (no DB id, role:'admin', '*' perms).
 * 2. Otherwise look up the user in the DB. They must have an admin role
 *    (admin/manager/staff), be active, and pass bcrypt.
 */
const adminLogin = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        // Path 1: env-based super admin (preserves existing single-admin
        // deployments without requiring a DB user to be seeded).
        if (
            process.env.ADMIN_EMAIL &&
            email === String(process.env.ADMIN_EMAIL).toLowerCase() &&
            password === process.env.ADMIN_PASSWORD
        ) {
            const token = signAdminToken(buildLegacySuperAdminPayload(email));
            return res.status(200).json({
                success: true,
                token,
                user: buildLegacySuperAdminProfile(email)
            });
        }

        // Path 2: DB-backed admin/manager/staff
        const user = await userModel.findOne({ email });
        if (!user || !['admin', 'manager', 'staff'].includes(user.role)) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
        }

        if (user.isActive === false) {
            return res.status(403).json({ success: false, message: 'This account is disabled' });
        }

        if (!user.password) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
        }

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
        }

        user.lastLoginAt = new Date();
        await user.save();

        const token = signAdminToken(buildAdminTokenPayload(user));
        return res.status(200).json({
            success: true,
            token,
            user: buildAdminProfile(user)
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error in admin login');
        return res.status(500).json({ success: false, message: 'Unable to login' });
    }
};

/**
 * Returns the currently authenticated admin actor's profile, including the
 * fresh permission set (re-read from DB to honor recent permission edits).
 */
const getCurrentAdmin = async (req, res) => {
    try {
        if (!req.admin) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        if (!req.admin.id) {
            return res.status(200).json({
                success: true,
                user: buildLegacySuperAdminProfile(req.admin.email)
            });
        }

        const user = await userModel.findById(req.admin.id);
        if (!user || user.isActive === false) {
            return res.status(403).json({ success: false, message: 'Account disabled' });
        }

        return res.status(200).json({ success: true, user: buildAdminProfile(user) });
    } catch (error) {
        req.log?.error({ err: error }, 'Error fetching current admin');
        return res.status(500).json({ success: false, message: 'Unable to load profile' });
    }
};

/**
 * Returns the static permission catalog so the admin UI can render the
 * permission matrix without hard-coding it.
 */
const getPermissionCatalog = (req, res) => {
    const modules = Object.entries(PERMISSION_MODULES).map(([key, def]) => ({
        key,
        label: def.label,
        actions: def.actions.map((action) => ({
            action,
            permission: `${key}.${action}`
        }))
    }));

    return res.status(200).json({
        success: true,
        catalog: {
            wildcard: PERMISSION_WILDCARD,
            modules,
            allPermissions: ALL_PERMISSIONS,
            roleTemplates: ROLE_PERMISSION_TEMPLATES
        }
    });
};

// ── Admin user CRUD ────────────────────────────────────────────────────────

const writeAuditLog = async ({ req, action, target, before, after, metadata }) => {
    try {
        await auditLogModel.create({
            actorId: req.admin?.id || null,
            actorEmail: req.admin?.email || '',
            actorRole: req.admin?.role || '',
            action,
            targetType: 'user',
            targetId: target?._id || null,
            targetLabel: target?.email || '',
            before: before || null,
            after: after || null,
            metadata: metadata || null,
            ip: req.ip || ''
        });
    } catch (error) {
        req.log?.warn({ err: error }, 'Failed to write audit log');
    }
};

/**
 * Privilege escalation guard. The acting admin can only:
 *  - assign permissions they themselves hold (or '*' if they hold '*')
 *  - manage users with roles below or equal to their own
 *
 * For now we treat admin > manager > staff. Only '*' holders may grant '*'.
 */
const ROLE_RANK = { admin: 3, manager: 2, staff: 1 };

const canActorManageRole = (actor, targetRole) => {
    if (actor?.isSuperAdmin) return true;
    const actorRank = ROLE_RANK[actor?.role] || 0;
    const targetRank = ROLE_RANK[targetRole] || 0;
    return actorRank >= targetRank;
};

const canActorGrantPermissions = (actor, requestedPermissions) => {
    if (!Array.isArray(requestedPermissions) || requestedPermissions.length === 0) return true;
    if (actor?.isSuperAdmin) return true;
    const grants = new Set(actor?.permissions || []);
    return requestedPermissions.every((perm) => {
        if (perm === PERMISSION_WILDCARD) return false; // only '*' holders may grant '*'
        return grants.has(perm) || grants.has(PERMISSION_WILDCARD);
    });
};

const listAdminUsers = async (req, res) => {
    try {
        const users = await userModel
            .find({ role: { $in: ['admin', 'manager', 'staff'] } })
            .select('name email role permissions isActive createdBy createdAt updatedAt lastLoginAt')
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            success: true,
            users: users.map((u) => buildAdminProfile(u))
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error listing admin users');
        return res.status(500).json({ success: false, message: 'Unable to load admin users' });
    }
};

const createAdminUser = async (req, res) => {
    try {
        const { name, email, password, role, isActive } = req.body;
        const requestedPermissions = sanitizePermissions(
            Array.isArray(req.body.permissions) && req.body.permissions.length > 0
                ? req.body.permissions
                : getRoleTemplate(role)
        );

        if (!canActorManageRole(req.admin, role)) {
            return res.status(403).json({
                success: false,
                message: `You cannot create users with role '${role}'`
            });
        }

        if (!canActorGrantPermissions(req.admin, requestedPermissions)) {
            return res.status(403).json({
                success: false,
                message: 'You can only grant permissions you hold yourself'
            });
        }

        const existing = await userModel.findOne({ email });
        if (existing) {
            return res.status(409).json({ success: false, message: 'A user with this email already exists' });
        }

        const hashed = await bcrypt.hash(password, 10);
        const user = await userModel.create({
            name,
            email,
            password: hashed,
            authProvider: 'local',
            role,
            permissions: requestedPermissions,
            isActive: isActive !== false,
            createdBy: req.admin?.id || null
        });

        await writeAuditLog({
            req,
            action: 'admin_user.create',
            target: user,
            after: { role, permissions: requestedPermissions, isActive: user.isActive }
        });

        return res.status(201).json({ success: true, user: buildAdminProfile(user) });
    } catch (error) {
        req.log?.error({ err: error }, 'Error creating admin user');
        return res.status(500).json({ success: false, message: 'Unable to create user' });
    }
};

const updateAdminUser = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await userModel.findById(id);

        if (!user || !['admin', 'manager', 'staff'].includes(user.role)) {
            return res.status(404).json({ success: false, message: 'Admin user not found' });
        }

        // Prevent self-demotion / self-deactivation footguns.
        if (req.admin?.id && String(req.admin.id) === String(user._id)) {
            if (req.body.role && req.body.role !== user.role) {
                return res.status(400).json({ success: false, message: 'You cannot change your own role' });
            }
            if (req.body.isActive === false) {
                return res.status(400).json({ success: false, message: 'You cannot disable your own account' });
            }
        }

        if (!canActorManageRole(req.admin, user.role)) {
            return res.status(403).json({ success: false, message: 'You cannot modify this user' });
        }

        const before = {
            name: user.name,
            role: user.role,
            permissions: [...(user.permissions || [])],
            isActive: user.isActive
        };

        if (req.body.name !== undefined) user.name = String(req.body.name).trim();

        if (req.body.role !== undefined) {
            if (!canActorManageRole(req.admin, req.body.role)) {
                return res.status(403).json({
                    success: false,
                    message: `You cannot promote users to '${req.body.role}'`
                });
            }
            user.role = req.body.role;
        }

        if (req.body.permissions !== undefined) {
            const cleaned = sanitizePermissions(req.body.permissions);
            if (!canActorGrantPermissions(req.admin, cleaned)) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only grant permissions you hold yourself'
                });
            }
            user.permissions = cleaned;
        }

        if (req.body.isActive !== undefined) user.isActive = Boolean(req.body.isActive);

        if (req.body.password) {
            user.password = await bcrypt.hash(req.body.password, 10);
        }

        await user.save();

        await writeAuditLog({
            req,
            action: 'admin_user.update',
            target: user,
            before,
            after: {
                name: user.name,
                role: user.role,
                permissions: user.permissions,
                isActive: user.isActive,
                passwordChanged: Boolean(req.body.password)
            }
        });

        return res.status(200).json({ success: true, user: buildAdminProfile(user) });
    } catch (error) {
        req.log?.error({ err: error }, 'Error updating admin user');
        return res.status(500).json({ success: false, message: 'Unable to update user' });
    }
};

const deleteAdminUser = async (req, res) => {
    try {
        const { id } = req.params;

        if (req.admin?.id && String(req.admin.id) === String(id)) {
            return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
        }

        const user = await userModel.findById(id);
        if (!user || !['admin', 'manager', 'staff'].includes(user.role)) {
            return res.status(404).json({ success: false, message: 'Admin user not found' });
        }

        if (!canActorManageRole(req.admin, user.role)) {
            return res.status(403).json({ success: false, message: 'You cannot delete this user' });
        }

        await user.deleteOne();

        await writeAuditLog({
            req,
            action: 'admin_user.delete',
            target: user,
            before: { role: user.role, permissions: user.permissions, isActive: user.isActive }
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        req.log?.error({ err: error }, 'Error deleting admin user');
        return res.status(500).json({ success: false, message: 'Unable to delete user' });
    }
};

const updateAdminUserPermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const cleaned = sanitizePermissions(req.body.permissions);

        const user = await userModel.findById(id);
        if (!user || !['admin', 'manager', 'staff'].includes(user.role)) {
            return res.status(404).json({ success: false, message: 'Admin user not found' });
        }

        if (!canActorManageRole(req.admin, user.role)) {
            return res.status(403).json({ success: false, message: 'You cannot modify this user' });
        }

        if (!canActorGrantPermissions(req.admin, cleaned)) {
            return res.status(403).json({
                success: false,
                message: 'You can only grant permissions you hold yourself'
            });
        }

        const before = { permissions: [...(user.permissions || [])] };
        user.permissions = cleaned;
        await user.save();

        await writeAuditLog({
            req,
            action: 'admin_user.assign_permissions',
            target: user,
            before,
            after: { permissions: cleaned }
        });

        return res.status(200).json({ success: true, user: buildAdminProfile(user) });
    } catch (error) {
        req.log?.error({ err: error }, 'Error updating admin user permissions');
        return res.status(500).json({ success: false, message: 'Unable to update permissions' });
    }
};

const setAdminUserStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const isActive = Boolean(req.body.isActive);

        if (req.admin?.id && String(req.admin.id) === String(id) && !isActive) {
            return res.status(400).json({ success: false, message: 'You cannot disable your own account' });
        }

        const user = await userModel.findById(id);
        if (!user || !['admin', 'manager', 'staff'].includes(user.role)) {
            return res.status(404).json({ success: false, message: 'Admin user not found' });
        }

        if (!canActorManageRole(req.admin, user.role)) {
            return res.status(403).json({ success: false, message: 'You cannot modify this user' });
        }

        const before = { isActive: user.isActive };
        user.isActive = isActive;
        await user.save();

        await writeAuditLog({
            req,
            action: isActive ? 'admin_user.enable' : 'admin_user.disable',
            target: user,
            before,
            after: { isActive }
        });

        return res.status(200).json({ success: true, user: buildAdminProfile(user) });
    } catch (error) {
        req.log?.error({ err: error }, 'Error setting admin user status');
        return res.status(500).json({ success: false, message: 'Unable to update status' });
    }
};

const listAuditLog = async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
        const entries = await auditLogModel
            .find({})
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return res.status(200).json({ success: true, entries });
    } catch (error) {
        req.log?.error({ err: error }, 'Error listing audit log');
        return res.status(500).json({ success: false, message: 'Unable to load audit log' });
    }
};

export {
    adminLogin,
    getCurrentAdmin,
    getPermissionCatalog,
    listAdminUsers,
    createAdminUser,
    updateAdminUser,
    deleteAdminUser,
    updateAdminUserPermissions,
    setAdminUserStatus,
    listAuditLog
};
