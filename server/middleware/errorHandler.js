const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
};

const resolveErrorResponse = (err) => {
    if (err?.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return {
                statusCode: 400,
                message: 'Image uploads must be 5 MB or smaller'
            };
        }

        return {
            statusCode: 400,
            message: err.message || 'Invalid upload request'
        };
    }

    if (err?.message === 'Only image files are allowed') {
        return {
            statusCode: 400,
            message: err.message
        };
    }

    if (err?.message === 'Review media uploads are not configured on the server') {
        return {
            statusCode: 503,
            message: err.message
        };
    }

    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;

    return {
        statusCode,
        message: statusCode >= 500 ? 'Internal server error' : (err?.message || 'Request failed')
    };
};

const errorHandler = (err, req, res, next) => {
    req.log?.error({ err }, 'Unhandled server error');
    const { statusCode, message } = resolveErrorResponse(err);

    if (res.headersSent) {
        return next(err);
    }

    return res.status(statusCode).json({
        success: false,
        message
    });
};

export { notFoundHandler, errorHandler };
