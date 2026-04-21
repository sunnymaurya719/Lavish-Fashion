/**
 * RBAC permission catalog.
 *
 * Format: <module>.<action>
 *
 * The wildcard '*' grants every permission and is reserved for the built-in
 * super admin (env-based ADMIN_EMAIL). Database-backed admin users may also
 * be granted '*' explicitly via permission assignment.
 *
 * Modules mirror the admin sidebar sections so that the same identifiers
 * can drive both backend authorization and frontend nav filtering.
 */

const PERMISSION_WILDCARD = '*';

const ADMIN_ROLES = Object.freeze(['admin', 'manager', 'staff']);

// Roles allowed to LOG IN to the admin dashboard.
const ADMIN_LOGIN_ROLES = new Set(ADMIN_ROLES);

const PERMISSION_MODULES = Object.freeze({
    orders: {
        label: 'Orders',
        actions: ['view', 'update', 'refund', 'export']
    },
    refunds: {
        label: 'Refunds',
        actions: [
            'view',
            'initiate',
            'approve_high_value',
            'mark_processed',
            'view_ledger'
        ]
    },
    customers: {
        label: 'Customers',
        actions: ['view', 'update', 'delete']
    },
    reviews: {
        label: 'Reviews',
        actions: ['view', 'moderate', 'reply', 'delete']
    },
    products: {
        label: 'Products',
        actions: ['view', 'create', 'update', 'delete']
    },
    inventory: {
        label: 'Inventory',
        actions: ['view', 'update']
    },
    coupons: {
        label: 'Coupons',
        actions: ['view', 'create', 'update', 'delete']
    },
    marketing: {
        label: 'Marketing',
        actions: ['view', 'create', 'send', 'delete']
    },
    dashboard: {
        label: 'Dashboard',
        actions: ['view']
    },
    loyalty: {
        label: 'Loyalty',
        actions: ['view', 'adjust']
    },
    analytics: {
        label: 'Fit Analytics',
        actions: ['view', 'export']
    },
    users: {
        label: 'Admin Users',
        actions: ['view', 'create', 'update', 'delete', 'assign_permissions']
    },
    settings: {
        label: 'Settings',
        actions: ['view', 'update']
    }
});

const ALL_PERMISSIONS = Object.freeze(
    Object.entries(PERMISSION_MODULES).flatMap(([module, def]) =>
        def.actions.map((action) => `${module}.${action}`)
    )
);

const ALL_PERMISSIONS_SET = new Set(ALL_PERMISSIONS);

const isValidPermission = (perm) =>
    perm === PERMISSION_WILDCARD || ALL_PERMISSIONS_SET.has(String(perm || ''));

const sanitizePermissions = (input) => {
    if (!Array.isArray(input)) return [];
    const cleaned = input
        .map((value) => String(value || '').trim())
        .filter((value) => isValidPermission(value));
    return Array.from(new Set(cleaned));
};

/**
 * Default permission templates per role. Used when the admin does not
 * explicitly select permissions while creating a user.
 */
const ROLE_PERMISSION_TEMPLATES = Object.freeze({
    admin: [PERMISSION_WILDCARD],
    manager: [
        'orders.view', 'orders.update', 'orders.refund',
        'refunds.view', 'refunds.initiate', 'refunds.approve_high_value',
        'refunds.mark_processed', 'refunds.view_ledger',
        'customers.view', 'customers.update',
        'reviews.view', 'reviews.moderate', 'reviews.reply',
        'products.view', 'products.create', 'products.update',
        'inventory.view', 'inventory.update',
        'coupons.view', 'coupons.create', 'coupons.update',
        'marketing.view', 'marketing.create', 'marketing.send',
        'dashboard.view',
        'loyalty.view', 'loyalty.adjust',
        'analytics.view'
    ],
    staff: [
        'orders.view', 'orders.update',
        'refunds.view', 'refunds.initiate',
        'customers.view',
        'reviews.view', 'reviews.moderate',
        'products.view',
        'inventory.view',
        'dashboard.view'
    ]
});

const getRoleTemplate = (role) => {
    const tpl = ROLE_PERMISSION_TEMPLATES[role];
    return Array.isArray(tpl) ? [...tpl] : [];
};

/**
 * Returns true if the supplied permission grant satisfies the requested
 * permission. The wildcard '*' satisfies anything; an exact module.action
 * match also satisfies. A module-level wildcard like 'orders.*' satisfies
 * any action under orders.
 */
const grantSatisfies = (grant, requested) => {
    if (grant === PERMISSION_WILDCARD) return true;
    if (grant === requested) return true;
    const dot = grant.indexOf('.');
    if (dot > 0 && grant.slice(dot + 1) === '*') {
        const moduleName = grant.slice(0, dot);
        return requested.startsWith(`${moduleName}.`);
    }
    return false;
};

const userHasPermission = (userPermissions, requested) => {
    if (!Array.isArray(userPermissions) || userPermissions.length === 0) return false;
    return userPermissions.some((grant) => grantSatisfies(String(grant || ''), requested));
};

const userHasAnyPermission = (userPermissions, requestedList) =>
    requestedList.some((perm) => userHasPermission(userPermissions, perm));

const userHasAllPermissions = (userPermissions, requestedList) =>
    requestedList.every((perm) => userHasPermission(userPermissions, perm));

export {
    PERMISSION_WILDCARD,
    ADMIN_ROLES,
    ADMIN_LOGIN_ROLES,
    PERMISSION_MODULES,
    ALL_PERMISSIONS,
    ROLE_PERMISSION_TEMPLATES,
    isValidPermission,
    sanitizePermissions,
    getRoleTemplate,
    grantSatisfies,
    userHasPermission,
    userHasAnyPermission,
    userHasAllPermissions
};
