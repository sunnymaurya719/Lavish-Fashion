/**
 * Refund state machine.
 *
 *      ┌──────────────────────────────────────┐
 *      │            permanently_failed         │  (terminal)
 *      └──────────────▲────────────────────────┘
 *                     │ (retry exhausted)
 *   initiated  ──▶  pending  ──▶  processed   (terminal)
 *      │              │
 *      │              ▼
 *      └────────▶  failed  ──▶  pending       (retry path)
 *
 * Notes:
 *   - `initiated` is the row's first state, set when the gateway call has
 *      not yet been attempted (or is in flight).
 *   - For manual bank-transfer (COD) refunds we allow `initiated → processed`
 *      directly, because there is no gateway "pending" leg — an admin marks
 *      the transfer settled in one step.
 *   - State changes ONLY through `transition()`. Direct assignment of
 *      `refund.state` outside the state machine is a bug.
 */

const RefundState = Object.freeze({
    INITIATED: 'initiated',
    PENDING: 'pending',
    PROCESSED: 'processed',
    FAILED: 'failed',
    PERMANENTLY_FAILED: 'permanently_failed'
});

const REFUND_STATES = Object.freeze(Object.values(RefundState));

const isRefundState = (value) => REFUND_STATES.includes(value);

// Adjacency list of legal transitions.
const VALID_TRANSITIONS = Object.freeze({
    [RefundState.INITIATED]: new Set([
        RefundState.PENDING,
        RefundState.PROCESSED, // manual bank transfer fast-path
        RefundState.FAILED
    ]),
    [RefundState.PENDING]: new Set([
        RefundState.PROCESSED,
        RefundState.FAILED
    ]),
    [RefundState.FAILED]: new Set([
        RefundState.PENDING,
        RefundState.PERMANENTLY_FAILED
    ]),
    // Terminal states.
    [RefundState.PROCESSED]: new Set(),
    [RefundState.PERMANENTLY_FAILED]: new Set()
});

/**
 * Webhook ordering safety. Razorpay does not guarantee event delivery
 * order, and a `refund.failed` may follow a `refund.processed` for the
 * same id. We resolve conflicts by priority: a higher number wins.
 *
 * `processed` is the highest because once Razorpay has settled funds we
 * trust that over any subsequent failure noise.
 */
const STATE_PRIORITY = Object.freeze({
    [RefundState.PERMANENTLY_FAILED]: 0,
    [RefundState.FAILED]: 1,
    [RefundState.INITIATED]: 2,
    [RefundState.PENDING]: 3,
    [RefundState.PROCESSED]: 4
});

const canTransition = (from, to) => {
    if (!isRefundState(from) || !isRefundState(to)) return false;
    if (from === to) return false;
    return VALID_TRANSITIONS[from].has(to);
};

/**
 * Pure transition function. Throws `InvalidRefundTransitionError` from
 * the caller's typed-error import on illegal moves; we throw a plain
 * Error here to keep this file dependency-free, and the caller is
 * expected to translate.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string} The new state (always equal to `to` on success).
 */
const transition = (from, to) => {
    if (!canTransition(from, to)) {
        const error = new Error(
            `Invalid refund transition: ${from} → ${to}`
        );
        error.code = 'INVALID_REFUND_TRANSITION';
        error.from = from;
        error.to = to;
        throw error;
    }
    return to;
};

/**
 * Decide whether a webhook-supplied state should overwrite the current
 * persisted state. Used to discard out-of-order updates.
 *
 * Rules:
 *   - Both states must be valid refund states.
 *   - Terminal states (processed, permanently_failed) are never regressed.
 *   - The proposed transition must be a legal state-machine edge.
 *
 * `STATE_PRIORITY` is still exported for callers that need a numeric
 * comparator, but it is NOT used to gate webhook updates because a
 * legitimate `pending → failed` would otherwise be rejected.
 */
const shouldUpdateFromWebhook = (current, incoming) => {
    if (!isRefundState(current) || !isRefundState(incoming)) return false;
    if (current === incoming) return false;
    if (isTerminalState(current)) return false;
    return canTransition(current, incoming);
};

const isTerminalState = (state) =>
    state === RefundState.PROCESSED || state === RefundState.PERMANENTLY_FAILED;

export {
    REFUND_STATES,
    RefundState,
    STATE_PRIORITY,
    canTransition,
    isRefundState,
    isTerminalState,
    shouldUpdateFromWebhook,
    transition
};
