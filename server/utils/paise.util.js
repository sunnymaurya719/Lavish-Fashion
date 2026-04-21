/**
 * Money utilities. Every internal money value MUST be an integer number of
 * paise. Floats are forbidden — they accumulate rounding errors that
 * reconciliation will eventually catch and that customers will rightfully
 * complain about.
 *
 * The only legitimate sources of float are:
 *   1. Legacy `order.amount` (rupees, kept untouched for backwards compat).
 *   2. Razorpay SDK responses (which use paise integers — but JSON parsing
 *      occasionally hands them to us as Number).
 *
 * Both call sites must funnel through `rupeeToPaise` / `paiseFromOrderRupees`
 * before the value is stored or compared.
 */

// 2^53 - 1 — the largest integer JS can represent exactly. We refuse to do
// math on anything bigger than this; ₹90 trillion is well past anything an
// ecommerce order will ever see, but a buggy migration could theoretically
// produce a value this large and we want it to fail loudly.
const MAX_SAFE_PAISE = Number.MAX_SAFE_INTEGER;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Asserts that `value` is a non-negative integer within safe range.
 * Throws otherwise. Use at every public API boundary.
 *
 * @param {unknown} value
 * @param {string} [label]
 */
const assertPaise = (value, label = 'paise value') => {
    if (!isFiniteNumber(value)) {
        throw new TypeError(`${label} must be a finite number, received ${typeof value}`);
    }
    if (!Number.isInteger(value)) {
        throw new TypeError(`${label} must be an integer (got ${value})`);
    }
    if (value < 0) {
        throw new RangeError(`${label} must be >= 0 (got ${value})`);
    }
    if (value > MAX_SAFE_PAISE) {
        throw new RangeError(`${label} exceeds Number.MAX_SAFE_INTEGER (got ${value})`);
    }
};

/**
 * Convert an arbitrary user-supplied rupee value to paise.
 * Accepts numbers and numeric strings. Rejects floats with more than
 * two decimal digits (the common copy-paste bug from frontend forms).
 *
 * @param {number|string} rupees
 * @returns {number}
 */
const rupeeToPaise = (rupees) => {
    if (rupees === null || rupees === undefined || rupees === '') {
        throw new TypeError('rupeeToPaise requires a value');
    }
    const numeric = typeof rupees === 'string' ? Number(rupees.trim()) : rupees;
    if (!isFiniteNumber(numeric)) {
        throw new TypeError(`rupeeToPaise: cannot parse "${rupees}"`);
    }
    if (numeric < 0) {
        throw new RangeError(`rupeeToPaise: negative amount ${numeric}`);
    }
    // Reject obviously broken inputs like 12.345 — INR has only paise (0.01).
    // We allow tiny float noise (e.g. 12.10000000000001) by rounding to 2dp
    // before comparing.
    const rounded = Math.round(numeric * 100) / 100;
    if (Math.abs(rounded - numeric) > 1e-6) {
        throw new RangeError(`rupeeToPaise: more than 2 decimal places in ${numeric}`);
    }
    const paise = Math.round(rounded * 100);
    assertPaise(paise, 'rupeeToPaise result');
    return paise;
};

/**
 * Convert legacy `order.amount` (rupees, possibly fractional) to paise.
 * Identical to `rupeeToPaise` but with a label that makes log triage easier.
 */
const paiseFromOrderRupees = (rupees) => {
    try {
        return rupeeToPaise(rupees);
    } catch (error) {
        const wrapped = new RangeError(
            `paiseFromOrderRupees: ${error.message} (legacy order.amount may be malformed)`
        );
        wrapped.cause = error;
        throw wrapped;
    }
};

/**
 * Convert paise back to a rupee number for display only. Never use the
 * result for storage or for further math.
 */
const paiseToRupees = (paise) => {
    assertPaise(paise, 'paiseToRupees input');
    // Division by 100 of an integer up to MAX_SAFE_PAISE is exact in IEEE 754
    // for all values we care about (the largest is well below 2^53).
    return paise / 100;
};

const safePaiseAdd = (a, b) => {
    assertPaise(a, 'safePaiseAdd:a');
    assertPaise(b, 'safePaiseAdd:b');
    const result = a + b;
    assertPaise(result, 'safePaiseAdd result');
    return result;
};

const safePaiseSub = (a, b) => {
    assertPaise(a, 'safePaiseSub:a');
    assertPaise(b, 'safePaiseSub:b');
    if (b > a) {
        throw new RangeError(`safePaiseSub: result would be negative (${a} - ${b})`);
    }
    return a - b;
};

export {
    MAX_SAFE_PAISE,
    assertPaise,
    paiseFromOrderRupees,
    paiseToRupees,
    rupeeToPaise,
    safePaiseAdd,
    safePaiseSub
};
