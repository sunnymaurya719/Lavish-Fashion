import { describe, expect, it } from 'vitest';

import {
    MAX_SAFE_PAISE,
    assertPaise,
    paiseFromOrderRupees,
    paiseToRupees,
    rupeeToPaise,
    safePaiseAdd,
    safePaiseSub
} from '../utils/paise.util.js';

describe('paise.util', () => {
    describe('rupeeToPaise', () => {
        it('converts whole rupees', () => {
            expect(rupeeToPaise(1)).toBe(100);
            expect(rupeeToPaise(0)).toBe(0);
            expect(rupeeToPaise(1234)).toBe(123400);
        });

        it('converts two-decimal rupees exactly', () => {
            expect(rupeeToPaise(1.99)).toBe(199);
            expect(rupeeToPaise(0.01)).toBe(1);
            expect(rupeeToPaise(99999.99)).toBe(9999999);
        });

        it('rejects non-finite numbers', () => {
            expect(() => rupeeToPaise(Number.NaN)).toThrow();
            expect(() => rupeeToPaise(Number.POSITIVE_INFINITY)).toThrow();
        });

        it('rejects negative values', () => {
            expect(() => rupeeToPaise(-1)).toThrow();
        });

        it('rejects values with more than 2 decimal places', () => {
            expect(() => rupeeToPaise(1.234)).toThrow();
            expect(() => rupeeToPaise(0.001)).toThrow();
        });

        it('rejects strings that are not numeric', () => {
            expect(() => rupeeToPaise('abc')).toThrow();
        });

        it('accepts numeric strings', () => {
            expect(rupeeToPaise('99.50')).toBe(9950);
        });
    });

    describe('paiseToRupees', () => {
        it('converts paise to rupees with 2dp', () => {
            expect(paiseToRupees(100)).toBe(1);
            expect(paiseToRupees(199)).toBe(1.99);
            expect(paiseToRupees(0)).toBe(0);
        });

        it('rejects non-integers', () => {
            expect(() => paiseToRupees(1.5)).toThrow();
        });
    });

    describe('paiseFromOrderRupees', () => {
        it('wraps rupeeToPaise with legacy context', () => {
            expect(paiseFromOrderRupees(99.5)).toBe(9950);
        });
    });

    describe('safePaiseAdd', () => {
        it('adds two paise values', () => {
            expect(safePaiseAdd(100, 200)).toBe(300);
        });
        it('rejects overflow', () => {
            expect(() => safePaiseAdd(MAX_SAFE_PAISE, 1)).toThrow();
        });
    });

    describe('safePaiseSub', () => {
        it('subtracts two paise values', () => {
            expect(safePaiseSub(500, 200)).toBe(300);
        });
        it('rejects negative result', () => {
            expect(() => safePaiseSub(100, 200)).toThrow();
        });
    });

    describe('assertPaise', () => {
        it('passes for valid integer', () => {
            expect(() => assertPaise(0, 'x')).not.toThrow();
            expect(() => assertPaise(MAX_SAFE_PAISE, 'x')).not.toThrow();
        });
        it('throws for negatives, floats, NaN', () => {
            expect(() => assertPaise(-1, 'x')).toThrow();
            expect(() => assertPaise(1.5, 'x')).toThrow();
            expect(() => assertPaise(Number.NaN, 'x')).toThrow();
        });
    });
});
