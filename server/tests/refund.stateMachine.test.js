import { describe, expect, it } from 'vitest';

import {
    REFUND_STATES,
    RefundState,
    canTransition,
    isRefundState,
    isTerminalState,
    shouldUpdateFromWebhook,
    transition
} from '../utils/refundStateMachine.js';

describe('refundStateMachine', () => {
    it('exposes the canonical state set', () => {
        expect(REFUND_STATES).toContain(RefundState.INITIATED);
        expect(REFUND_STATES).toContain(RefundState.PROCESSED);
        expect(REFUND_STATES).toContain(RefundState.PERMANENTLY_FAILED);
    });

    describe('canTransition', () => {
        it('allows initiated → pending', () => {
            expect(canTransition(RefundState.INITIATED, RefundState.PENDING)).toBe(true);
        });
        it('allows initiated → processed (manual fast-path)', () => {
            expect(canTransition(RefundState.INITIATED, RefundState.PROCESSED)).toBe(true);
        });
        it('allows pending → processed', () => {
            expect(canTransition(RefundState.PENDING, RefundState.PROCESSED)).toBe(true);
        });
        it('allows failed → pending (retry)', () => {
            expect(canTransition(RefundState.FAILED, RefundState.PENDING)).toBe(true);
        });
        it('allows failed → permanently_failed', () => {
            expect(canTransition(RefundState.FAILED, RefundState.PERMANENTLY_FAILED)).toBe(true);
        });
        it('forbids processed → anything', () => {
            for (const target of REFUND_STATES) {
                if (target !== RefundState.PROCESSED) {
                    expect(canTransition(RefundState.PROCESSED, target)).toBe(false);
                }
            }
        });
        it('forbids permanently_failed → anything', () => {
            for (const target of REFUND_STATES) {
                if (target !== RefundState.PERMANENTLY_FAILED) {
                    expect(canTransition(RefundState.PERMANENTLY_FAILED, target)).toBe(false);
                }
            }
        });
        it('forbids initiated → permanently_failed', () => {
            expect(canTransition(RefundState.INITIATED, RefundState.PERMANENTLY_FAILED)).toBe(false);
        });
    });

    describe('transition', () => {
        it('returns target state for valid transitions', () => {
            expect(transition(RefundState.INITIATED, RefundState.PENDING)).toBe(RefundState.PENDING);
        });
        it('throws with INVALID_REFUND_TRANSITION code for invalid transitions', () => {
            try {
                transition(RefundState.PROCESSED, RefundState.FAILED);
                throw new Error('expected throw');
            } catch (error) {
                expect(error.code).toBe('INVALID_REFUND_TRANSITION');
            }
        });
    });

    describe('isTerminalState', () => {
        it('returns true for processed and permanently_failed', () => {
            expect(isTerminalState(RefundState.PROCESSED)).toBe(true);
            expect(isTerminalState(RefundState.PERMANENTLY_FAILED)).toBe(true);
        });
        it('returns false for initiated, pending, failed', () => {
            expect(isTerminalState(RefundState.INITIATED)).toBe(false);
            expect(isTerminalState(RefundState.PENDING)).toBe(false);
            expect(isTerminalState(RefundState.FAILED)).toBe(false);
        });
    });

    describe('isRefundState', () => {
        it('returns true for valid states', () => {
            expect(isRefundState(RefundState.PROCESSED)).toBe(true);
        });
        it('returns false for unknown values', () => {
            expect(isRefundState('done')).toBe(false);
            expect(isRefundState(null)).toBe(false);
        });
    });

    describe('shouldUpdateFromWebhook', () => {
        it('promotes pending → processed', () => {
            expect(shouldUpdateFromWebhook(RefundState.PENDING, RefundState.PROCESSED)).toBe(true);
        });
        it('does NOT regress processed → pending', () => {
            expect(shouldUpdateFromWebhook(RefundState.PROCESSED, RefundState.PENDING)).toBe(false);
        });
        it('does NOT regress processed → failed (out-of-order webhook)', () => {
            expect(shouldUpdateFromWebhook(RefundState.PROCESSED, RefundState.FAILED)).toBe(false);
        });
        it('promotes pending → failed (legitimate failure)', () => {
            expect(shouldUpdateFromWebhook(RefundState.PENDING, RefundState.FAILED)).toBe(true);
        });
    });
});
