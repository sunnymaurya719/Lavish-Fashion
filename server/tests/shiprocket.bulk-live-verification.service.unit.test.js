import { afterEach, describe, expect, it, vi } from 'vitest';

const orderModelMock = {
    find: vi.fn(),
    findById: vi.fn()
};

const publishAdminOrderUpsertMock = vi.fn();
const decorateOrderWithShiprocketPricingAuditMock = vi.fn();
const isShiprocketThrottleErrorMock = vi.fn();
const verifyOrderPricingAgainstLiveShiprocketMock = vi.fn();
const acquireDistributedLockMock = vi.fn();
const getDistributedLockMock = vi.fn();
const refreshDistributedLockMock = vi.fn();
const releaseDistributedLockMock = vi.fn();
const getSystemJobStateMock = vi.fn();
const markSystemJobCancelledMock = vi.fn();
const markSystemJobCompletedMock = vi.fn();
const markSystemJobFailedMock = vi.fn();
const markSystemJobSkippedMock = vi.fn();
const markSystemJobStartedMock = vi.fn();
const updateSystemJobStateMock = vi.fn();

vi.mock('../models/orderModel.js', () => ({
    default: orderModelMock
}));

vi.mock('../services/realtimeService.js', () => ({
    publishAdminOrderUpsert: publishAdminOrderUpsertMock
}));

vi.mock('../services/shiprocketService.js', () => ({
    SHIPROCKET_SYNC_STATUS: {
        synced: 'synced'
    },
    decorateOrderWithShiprocketPricingAudit: decorateOrderWithShiprocketPricingAuditMock,
    isShiprocketThrottleError: isShiprocketThrottleErrorMock,
    verifyOrderPricingAgainstLiveShiprocket: verifyOrderPricingAgainstLiveShiprocketMock
}));

vi.mock('../services/distributedLockService.js', () => ({
    acquireDistributedLock: acquireDistributedLockMock,
    getDistributedLock: getDistributedLockMock,
    refreshDistributedLock: refreshDistributedLockMock,
    releaseDistributedLock: releaseDistributedLockMock
}));

vi.mock('../services/systemJobStateService.js', () => ({
    getSystemJobState: getSystemJobStateMock,
    markSystemJobCancelled: markSystemJobCancelledMock,
    markSystemJobCompleted: markSystemJobCompletedMock,
    markSystemJobFailed: markSystemJobFailedMock,
    markSystemJobSkipped: markSystemJobSkippedMock,
    markSystemJobStarted: markSystemJobStartedMock,
    updateSystemJobState: updateSystemJobStateMock
}));

const {
    cancelShiprocketBulkLiveVerificationJob,
    getShiprocketBulkVerifyConfig,
    serializeShiprocketBulkVerifyJobState,
    startShiprocketBulkLiveVerificationJob
} = await import('../services/shiprocketBulkLiveVerificationService.js');

const createFindQueryMock = (orders) => ({
    sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(orders)
        })
    })
});

describe('shiprocketBulkLiveVerificationService', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('normalizes bulk live verification config values', () => {
        const config = getShiprocketBulkVerifyConfig({
            scope: 'invalid_scope',
            limit: 9999,
            requestsPerMinute: 9999
        });

        expect(config.scope).toBe('high_risk');
        expect(config.limit).toBe(500);
        expect(config.requestsPerMinute).toBe(180);
        expect(config.requestIntervalMs).toBeGreaterThanOrEqual(0);
        expect(config.lockTtlMs).toBeGreaterThan(0);
    });

    it('flags stale running job state during serialization', () => {
        const serializedState = serializeShiprocketBulkVerifyJobState({
            jobKey: 'shiprocket_live_pricing_bulk_verify_job',
            provider: 'shiprocket',
            jobType: 'live_pricing_bulk_verify',
            lastRunStatus: 'running',
            lastRequestedBy: 'admin@example.com',
            lastTrigger: 'admin_api',
            lastConfig: {
                scope: 'high_risk'
            },
            lastRunResult: {
                progress: {
                    totalCount: 10,
                    processedCount: 3
                }
            },
            activeRunExpiresAt: new Date(Date.now() - 60_000),
            updatedAt: new Date()
        });

        expect(serializedState.status).toBe('running');
        expect(serializedState.isStale).toBe(true);
        expect(serializedState.isCancelling).toBe(false);
        expect(serializedState.progress).toEqual(
            expect.objectContaining({
                totalCount: 10,
                processedCount: 3
            })
        );
    });

    it('skips bulk verification when no eligible orders are found', async () => {
        acquireDistributedLockMock.mockResolvedValueOnce({
            acquired: true,
            ownerId: 'lock-owner-1',
            lock: {
                key: 'shiprocket_live_pricing_bulk_verify_lock'
            }
        });
        orderModelMock.find.mockReturnValueOnce(createFindQueryMock([]));
        orderModelMock.find.mockReturnValueOnce(createFindQueryMock([]));
        markSystemJobSkippedMock.mockResolvedValueOnce({
            lastRunStatus: 'skipped'
        });
        releaseDistributedLockMock.mockResolvedValueOnce(true);
        getSystemJobStateMock.mockResolvedValueOnce({
            jobKey: 'shiprocket_live_pricing_bulk_verify_job',
            lastRunStatus: 'skipped',
            lastRunResult: {
                progress: {
                    totalCount: 0,
                    processedCount: 0
                }
            }
        });
        getDistributedLockMock.mockResolvedValueOnce(null);

        const result = await startShiprocketBulkLiveVerificationJob({
            config: {
                limit: 10,
                requestsPerMinute: 45,
                scope: 'high_risk'
            },
            requestedBy: 'admin@example.com',
            trigger: 'admin_api'
        });

        expect(result.started).toBe(false);
        expect(result.reason).toBe('no_target_orders');
        expect(markSystemJobSkippedMock).toHaveBeenCalledTimes(1);
        expect(releaseDistributedLockMock).toHaveBeenCalledTimes(1);
    });

    it('starts and completes a bulk verification run for a high-risk order', async () => {
        const highRiskOrder = {
            _id: '507f1f77bcf86cd799439031',
            shiprocket: {
                orderId: 41234,
                referenceOrderId: 'LFVERIFY001'
            }
        };

        acquireDistributedLockMock.mockResolvedValueOnce({
            acquired: true,
            ownerId: 'lock-owner-2',
            lock: {
                key: 'shiprocket_live_pricing_bulk_verify_lock',
                ownerId: 'lock-owner-2',
                expiresAt: new Date(Date.now() + 60_000)
            }
        });
        orderModelMock.find.mockReturnValueOnce(createFindQueryMock([highRiskOrder]));
        decorateOrderWithShiprocketPricingAuditMock.mockReturnValue({
            ...highRiskOrder,
            shiprocketPricingAudit: {
                hasMismatch: true,
                hasWarning: false
            }
        });
        markSystemJobStartedMock.mockResolvedValueOnce({
            lastRunStatus: 'running'
        });
        updateSystemJobStateMock.mockResolvedValue({});
        getSystemJobStateMock.mockResolvedValueOnce({
            jobKey: 'shiprocket_live_pricing_bulk_verify_job',
            provider: 'shiprocket',
            jobType: 'live_pricing_bulk_verify',
            lastRunStatus: 'running',
            lastConfig: {
                scope: 'high_risk',
                limit: 1,
                requestsPerMinute: 60
            },
            lastRunResult: {
                progress: {
                    totalCount: 1,
                    processedCount: 0
                }
            },
            lastRunStartedAt: new Date(),
            updatedAt: new Date()
        });
        getDistributedLockMock.mockResolvedValueOnce({
            key: 'shiprocket_live_pricing_bulk_verify_lock',
            ownerId: 'lock-owner-2',
            expiresAt: new Date(Date.now() + 60_000)
        });
        getSystemJobStateMock.mockResolvedValueOnce({
            lastRunResult: {}
        });
        verifyOrderPricingAgainstLiveShiprocketMock.mockResolvedValueOnce({
            status: 'clear',
            order: highRiskOrder
        });
        isShiprocketThrottleErrorMock.mockReturnValue(false);
        refreshDistributedLockMock.mockResolvedValue({
            key: 'shiprocket_live_pricing_bulk_verify_lock',
            ownerId: 'lock-owner-2'
        });
        publishAdminOrderUpsertMock.mockResolvedValueOnce({
            published: true
        });
        markSystemJobCompletedMock.mockResolvedValueOnce({
            lastRunStatus: 'completed'
        });
        releaseDistributedLockMock.mockResolvedValueOnce(true);

        const result = await startShiprocketBulkLiveVerificationJob({
            config: {
                limit: 1,
                requestsPerMinute: 60,
                scope: 'high_risk'
            },
            requestedBy: 'admin@example.com',
            trigger: 'admin_api'
        });

        expect(result.started).toBe(true);
        expect(markSystemJobStartedMock).toHaveBeenCalledTimes(1);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(verifyOrderPricingAgainstLiveShiprocketMock).toHaveBeenCalledWith(
            { _id: '507f1f77bcf86cd799439031' },
            expect.objectContaining({
                persist: true
            })
        );
        expect(publishAdminOrderUpsertMock).toHaveBeenCalledTimes(1);
        expect(markSystemJobCompletedMock).toHaveBeenCalledTimes(1);
        expect(releaseDistributedLockMock).toHaveBeenCalledTimes(1);
    });

    it('retries with backoff when Shiprocket throttles a live verification request', async () => {
        const throttledOrder = {
            _id: '507f1f77bcf86cd799439041',
            shiprocket: {
                orderId: 51234,
                referenceOrderId: 'LFVERIFYTHROTTLE'
            }
        };
        const throttleError = Object.assign(new Error('Too many requests'), {
            upstreamStatusCode: 429,
            retryAfterMs: 1,
            isThrottleError: true
        });

        acquireDistributedLockMock.mockResolvedValueOnce({
            acquired: true,
            ownerId: 'lock-owner-3',
            lock: {
                key: 'shiprocket_live_pricing_bulk_verify_lock',
                ownerId: 'lock-owner-3',
                expiresAt: new Date(Date.now() + 60_000)
            }
        });
        orderModelMock.find.mockReturnValueOnce(createFindQueryMock([throttledOrder]));
        decorateOrderWithShiprocketPricingAuditMock.mockReturnValue({
            ...throttledOrder,
            shiprocketPricingAudit: {
                hasMismatch: true,
                hasWarning: false
            }
        });
        markSystemJobStartedMock.mockResolvedValueOnce({
            lastRunStatus: 'running'
        });
        updateSystemJobStateMock.mockResolvedValue({});
        getSystemJobStateMock
            .mockResolvedValueOnce({
                jobKey: 'shiprocket_live_pricing_bulk_verify_job',
                provider: 'shiprocket',
                jobType: 'live_pricing_bulk_verify',
                lastRunStatus: 'running',
                lastRunResult: { progress: { totalCount: 1, processedCount: 0 } }
            })
            .mockResolvedValueOnce({ lastRunResult: {} })
            .mockResolvedValueOnce({ lastRunResult: {} });
        getDistributedLockMock.mockResolvedValueOnce({
            key: 'shiprocket_live_pricing_bulk_verify_lock',
            ownerId: 'lock-owner-3',
            expiresAt: new Date(Date.now() + 60_000)
        });
        verifyOrderPricingAgainstLiveShiprocketMock
            .mockRejectedValueOnce(throttleError)
            .mockResolvedValueOnce({
                status: 'clear',
                order: throttledOrder
            });
        isShiprocketThrottleErrorMock.mockImplementation((error) => Boolean(error?.isThrottleError));
        refreshDistributedLockMock.mockResolvedValue({
            key: 'shiprocket_live_pricing_bulk_verify_lock',
            ownerId: 'lock-owner-3'
        });
        publishAdminOrderUpsertMock.mockResolvedValueOnce({
            published: true
        });
        markSystemJobCompletedMock.mockResolvedValueOnce({
            lastRunStatus: 'completed'
        });
        releaseDistributedLockMock.mockResolvedValueOnce(true);

        const result = await startShiprocketBulkLiveVerificationJob({
            config: {
                limit: 1,
                requestsPerMinute: 60,
                scope: 'high_risk'
            },
            requestedBy: 'admin@example.com',
            trigger: 'admin_api'
        });

        expect(result.started).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(verifyOrderPricingAgainstLiveShiprocketMock).toHaveBeenCalledTimes(2);
        expect(markSystemJobCompletedMock).toHaveBeenCalledWith(
            expect.objectContaining({
                result: expect.objectContaining({
                    retryScheduledCount: 1
                })
            })
        );
    });

    it('records a cancel request for an active Shiprocket bulk live verification job', async () => {
        getSystemJobStateMock.mockResolvedValueOnce({
            jobKey: 'shiprocket_live_pricing_bulk_verify_job',
            provider: 'shiprocket',
            jobType: 'live_pricing_bulk_verify',
            lastRunStatus: 'running',
            lastRunResult: {
                progress: {
                    totalCount: 5,
                    processedCount: 2
                }
            }
        });
        getDistributedLockMock.mockResolvedValueOnce({
            key: 'shiprocket_live_pricing_bulk_verify_lock',
            ownerId: 'lock-owner-9',
            expiresAt: new Date(Date.now() + 60_000)
        });
        updateSystemJobStateMock.mockResolvedValueOnce({});
        getSystemJobStateMock.mockResolvedValueOnce({
            jobKey: 'shiprocket_live_pricing_bulk_verify_job',
            provider: 'shiprocket',
            jobType: 'live_pricing_bulk_verify',
            lastRunStatus: 'running',
            lastRunResult: {
                progress: {
                    totalCount: 5,
                    processedCount: 2
                },
                cancelRequestedAt: new Date().toISOString(),
                cancelRequestedBy: 'admin@example.com',
                cancelReason: 'manual_cancel'
            }
        });
        getDistributedLockMock.mockResolvedValueOnce({
            key: 'shiprocket_live_pricing_bulk_verify_lock',
            ownerId: 'lock-owner-9',
            expiresAt: new Date(Date.now() + 60_000)
        });

        const result = await cancelShiprocketBulkLiveVerificationJob({
            requestedBy: 'admin@example.com',
            reason: 'manual_cancel'
        });

        expect(result.cancelled).toBe(true);
        expect(result.reason).toBe('cancel_requested');
        expect(updateSystemJobStateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                updateSet: expect.objectContaining({
                    'lastRunResult.cancelRequestedBy': 'admin@example.com',
                    'lastRunResult.cancelReason': 'manual_cancel'
                })
            })
        );
    });
});
