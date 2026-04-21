import { describe, expect, it, vi } from 'vitest';

vi.mock('../models/userModel.js', () => ({
    default: {
        findById: vi.fn()
    }
}));

const userModelMock = (await import('../models/userModel.js')).default;

const buildSelectChain = (returnValue) => ({
    select: () => ({
        lean: async () => returnValue
    })
});

const buildRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

const { default: enforceRefundLimits, ROLE_LIMITS_PAISE, HIGH_VALUE_THRESHOLD_PAISE } =
    await import('../middleware/refundPermissions.js');

describe('refundPermissions middleware', () => {
    const buildReq = ({ adminRole, amountInPaise, approvedByAdminId, adminId = 'admin-self' }) => ({
        admin: { id: adminId, email: `${adminRole}@x.com`, role: adminRole },
        body: { amountInPaise, approvedByAdminId }
    });

    it('rejects when admin context is missing', async () => {
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits({ admin: null, body: { amountInPaise: 100 } }, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('rejects non-positive amounts', async () => {
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits(buildReq({ adminRole: 'admin', amountInPaise: 0 }), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('staff can refund up to ₹500', async () => {
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits(
            buildReq({ adminRole: 'staff', amountInPaise: ROLE_LIMITS_PAISE.staff }),
            res,
            next
        );
        expect(next).toHaveBeenCalled();
    });

    it('staff cannot exceed ₹500', async () => {
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits(
            buildReq({ adminRole: 'staff', amountInPaise: ROLE_LIMITS_PAISE.staff + 1 }),
            res,
            next
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('manager can refund up to ₹5,000', async () => {
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits(
            buildReq({ adminRole: 'manager', amountInPaise: ROLE_LIMITS_PAISE.manager }),
            res,
            next
        );
        expect(next).toHaveBeenCalled();
    });

    it('admin without approver fails dual-control above threshold', async () => {
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits(
            buildReq({ adminRole: 'admin', amountInPaise: HIGH_VALUE_THRESHOLD_PAISE + 1 }),
            res,
            next
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('rejects approver same as initiator', async () => {
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits(
            buildReq({
                adminRole: 'admin',
                amountInPaise: HIGH_VALUE_THRESHOLD_PAISE + 1,
                approvedByAdminId: 'admin-self'
            }),
            res,
            next
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('admin with valid manager approver passes high-value', async () => {
        userModelMock.findById.mockReturnValueOnce(
            buildSelectChain({
                _id: 'approver-id',
                email: 'approver@x.com',
                role: 'manager',
                isActive: true,
                permissions: ['refunds.approve_high_value']
            })
        );
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits(
            buildReq({
                adminRole: 'admin',
                amountInPaise: HIGH_VALUE_THRESHOLD_PAISE + 1,
                approvedByAdminId: 'approver-id'
            }),
            res,
            next
        );
        expect(next).toHaveBeenCalled();
    });

    it('rejects approver with insufficient role', async () => {
        userModelMock.findById.mockReturnValueOnce(
            buildSelectChain({
                _id: 'approver-id',
                email: 'staff@x.com',
                role: 'staff',
                isActive: true,
                permissions: []
            })
        );
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits(
            buildReq({
                adminRole: 'admin',
                amountInPaise: HIGH_VALUE_THRESHOLD_PAISE + 1,
                approvedByAdminId: 'approver-id'
            }),
            res,
            next
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('rejects inactive approver', async () => {
        userModelMock.findById.mockReturnValueOnce(
            buildSelectChain({
                _id: 'approver-id',
                email: 'mgr@x.com',
                role: 'manager',
                isActive: false,
                permissions: ['refunds.approve_high_value']
            })
        );
        const res = buildRes();
        const next = vi.fn();
        await enforceRefundLimits(
            buildReq({
                adminRole: 'admin',
                amountInPaise: HIGH_VALUE_THRESHOLD_PAISE + 1,
                approvedByAdminId: 'approver-id'
            }),
            res,
            next
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
