import { randomUUID } from 'crypto';
import logger from '../config/logger.js';

const requestLogger = (req, res, next) => {
    const requestIdHeader = req.headers['x-request-id'];
    const requestId = typeof requestIdHeader === 'string' && requestIdHeader.trim() ? requestIdHeader.trim() : randomUUID();

    req.id = requestId;
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const requestLog = logger.child({
        requestId,
        method: req.method,
        path: req.originalUrl
    });

    req.log = requestLog;

    const start = process.hrtime.bigint();
    requestLog.info({ event: 'request.start' }, 'Incoming request');

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        requestLog.info(
            {
                event: 'request.end',
                statusCode: res.statusCode,
                durationMs: Number(durationMs.toFixed(2))
            },
            'Request completed'
        );
    });

    next();
};

export default requestLogger;
