/**
 * Refund-specific permission gates layered on top of RBAC.
 *
 * Per-role refund amount caps:
 *   staff:       up to ₹500       (   50_000 paise)
 *   manager:     up to ₹5,000     (  500_000 paise)
 *   admin:       no cap
 *   superAdmin:  no cap
 *
 * Above ₹5,000, the request body MUST include `approvedByAdminId`,
 * which must resolve to a different admin with role `manager` or
 * higher. This is the dual-control rule.
 *
 * NOTE: this middleware assumes `adminAuth` and
 * `authorizePermissions('refunds.initiate')` have already populated
 * `req.admin = { id, email, role, permissions, isSuperAdmin }`.
 */

import userModel from '../models/userModel.js';
import { paiseToRupees } from '../utils/paise.util.js';
import { RefundPermissionError, RefundValidationError } from '../utils/refundErrors.js';
import { refundLogger } from '../utils/structuredLogger.js';

const PAISE = (rupees) => Math.round(rupees * 100);

const ROLE_LIMITS_PAISE = Object.freeze({
    staff: PAISE(500),
    manager: PAISE(5000),
    admin: Number.POSITIVE_INFINITY,
    superAdmin: Number.POSITIVE_INFINITY
});

const HIGH_VALUE_THRESHOLD_PAISE = PAISE(5000);

const ROLES_THAT_CAN_APPROVE = new Set(['manager', 'admin', 'superAdmin']);

const writeError = (res, error) =>
    res.status(error.statusCode || 403).json({
        success: false,
        message: error.message,
        code: error.code,
        details: error.details || undefined
    });

const enforceRefundLimits = async (req, res, next) => {
    try {
        const admin = req.admin;
        if (!admin?.role) {
            throw new RefundPermissionError('Admin context missing on request', {
                code: 'REFUND_ADMIN_MISSING'
            });
        }

        const amountInPaise = Number(req.body?.amountInPaise);
        if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
            throw new RefundValidationError(
                'amountInPaise must be a positive integer (paise) in request body'
            );
        }

        const limit = ROLE_LIMITS_PAISE[admin.role];
        if (limit === undefined) {
            throw new RefundPermissionError(
                `Role "${admin.role}" cannot initiate refunds`,
                { code: 'REFUND_ROLE_FORBIDDEN' }
            );
        }
        if (amountInPaise > limit) {
            throw new RefundPermissionError(
                `Role "${admin.role}" can refund up to ₹${paiseToRupees(limit)} per request (requested ₹${paiseToRupees(amountInPaise)})`,
                {
                    code: 'REFUND_AMOUNT_EXCEEDS_ROLE_LIMIT',
                    details: { roleLimitPaise: limit, requestedPaise: amountInPaise }
                }
            );
        }

        // Dual control above the high-value threshold.
        if (amountInPaise > HIGH_VALUE_THRESHOLD_PAISE) {
            const approverId = req.body?.approvedByAdminId;
            if (!approverId) {
                throw new RefundPermissionError(
                    `Refunds above ₹${paiseToRupees(HIGH_VALUE_THRESHOLD_PAISE)} require approvedByAdminId in body`,
                    { code: 'REFUND_HIGH_VALUE_APPROVAL_REQUIRED' }
                );
            }
            if (String(approverId) === String(admin.id)) {
                throw new RefundPermissionError(
                    'Approver must be a different admin than the initiator',
                    { code: 'REFUND_APPROVER_SAME_AS_INITIATOR' }
                );
            }

            const approver = await userModel
                .findById(approverId)
                .select('_id email role isActive permissions')
                .lean();

            if (!approver || approver.isActive === false) {
                throw new RefundPermissionError('Approver not found or inactive', {
                    code: 'REFUND_APPROVER_INVALID'
                });
            }
            if (!ROLES_THAT_CAN_APPROVE.has(approver.role)) {
                throw new RefundPermissionError(
                    `Approver role "${approver.role}" cannot approve high-value refunds`,
                    { code: 'REFUND_APPROVER_ROLE_INSUFFICIENT' }
                );
            }
            const approverPerms = Array.isArray(approver.permissions)
                ? approver.permissions
                : [];
            const approverHasPerm =
                approver.role === 'admin' ||
                approver.role === 'superAdmin' ||
                approverPerms.includes('refunds.approve_high_value');
            if (!approverHasPerm) {
                throw new RefundPermissionError(
                    'Approver lacks refunds.approve_high_value permission',
                    { code: 'REFUND_APPROVER_PERMISSION_MISSING' }
                );
            }

            req.body.approvedByAdminEmail = approver.email;
        }

        return next();
    } catch (error) {
        refundLogger.warn(
            {
                event: 'refund_permission_check_failed',
                err: error.message,
                code: error.code,
                adminEmail: req.admin?.email,
                amountInPaise: req.body?.amountInPaise
            },
            'Refund permission check failed'
        );
        if (error.statusCode) return writeError(res, error);
        return res.status(500).json({
            success: false,
            message: 'Permission check failed',
            error: error.message
        });
    }
};

export default enforceRefundLimits;
export {
    enforceRefundLimits,
    HIGH_VALUE_THRESHOLD_PAISE,
    ROLE_LIMITS_PAISE
};
