const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
};

const errorHandler = (err, req, res, next) => {
    req.log?.error({ err }, 'Unhandled server error');

    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const message = statusCode >= 500 ? 'Internal server error' : (err?.message || 'Request failed');

    if (res.headersSent) {
        return next(err);
    }

    return res.status(statusCode).json({
        success: false,
        message
    });
};

export { notFoundHandler, errorHandler };