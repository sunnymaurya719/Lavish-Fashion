/**
 * Typed error hierarchy for the refund subsystem. Every refund module
 * throws (or rethrows) a `RefundError` subclass — never a bare `Error`.
 * The HTTP layer maps `error.statusCode` directly to the response.
 */

class RefundError extends Error {
    constructor(message, { statusCode = 500, code = 'REFUND_ERROR', cause, retryable = false, details } = {}) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.retryable = Boolean(retryable);
        if (cause) this.cause = cause;
        if (details) this.details = details;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            retryable: this.retryable,
            details: this.details
        };
    }
}

class InsufficientRefundableAmountError extends RefundError {
    constructor(message = 'Refund amount exceeds the remaining refundable balance', details) {
        super(message, {
            statusCode: 409,
            code: 'INSUFFICIENT_REFUNDABLE_AMOUNT',
            details
        });
    }
}

class InvalidRefundTransitionError extends RefundError {
    constructor(from, to) {
        super(`Invalid refund transition: ${from} → ${to}`, {
            statusCode: 409,
            code: 'INVALID_REFUND_TRANSITION',
            details: { from, to }
        });
    }
}

class GatewayError extends RefundError {
    constructor(message, { retryable = false, statusCode = 502, cause, details } = {}) {
        super(message, {
            statusCode,
            code: 'REFUND_GATEWAY_ERROR',
            retryable,
            cause,
            details
        });
    }
}

class RefundPermissionError extends RefundError {
    constructor(message = 'You do not have permission to perform this refund operation', details) {
        super(message, {
            statusCode: 403,
            code: 'REFUND_PERMISSION_DENIED',
            details
        });
    }
}

class RefundValidationError extends RefundError {
    constructor(message, details) {
        super(message, {
            statusCode: 400,
            code: 'REFUND_VALIDATION_ERROR',
            details
        });
    }
}

class RefundNotFoundError extends RefundError {
    constructor(message = 'Refund not found', details) {
        super(message, {
            statusCode: 404,
            code: 'REFUND_NOT_FOUND',
            details
        });
    }
}

class WalletInsufficientBalanceError extends RefundError {
    // Reserved for a future wallet-credit strategy. Kept here so the
    // strategy interface is stable.
    constructor(message = 'Insufficient wallet balance for this operation', details) {
        super(message, {
            statusCode: 409,
            code: 'WALLET_INSUFFICIENT_BALANCE',
            details
        });
    }
}

class LedgerImmutabilityError extends RefundError {
    constructor(message = 'Ledger entries are append-only and cannot be modified') {
        super(message, {
            statusCode: 500,
            code: 'LEDGER_IMMUTABLE'
        });
    }
}

const isRefundError = (error) => error instanceof RefundError;

export {
    GatewayError,
    InsufficientRefundableAmountError,
    InvalidRefundTransitionError,
    LedgerImmutabilityError,
    RefundError,
    RefundNotFoundError,
    RefundPermissionError,
    RefundValidationError,
    WalletInsufficientBalanceError,
    isRefundError
};
