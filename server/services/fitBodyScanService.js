import { getCachedBodyScanAnalysis, setCachedBodyScanAnalysis } from './fitCacheService.js';
import { isMlServiceConfigured, requestMlBodyScanAnalysis } from './mlGatewayService.js';

const createBodyScanError = (message, statusCode = 503) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const analyzeBodyScan = async ({ scanInput, requestId = '', log = null }) => {
    const cachedResult = await getCachedBodyScanAnalysis({
        scanInput,
        requestId,
        log
    });

    if (cachedResult) {
        log?.info?.(
            {
                event: 'fit.cache.hit',
                requestId,
                cacheType: 'body_scan'
            },
            'Served body scan analysis from cache'
        );

        return {
            ...cachedResult,
            meta: {
                ...(cachedResult.meta || {}),
                cacheHit: true
            }
        };
    }

    if (!isMlServiceConfigured()) {
        throw createBodyScanError('Camera-based body scan is unavailable right now.', 503);
    }

    try {
        const result = await requestMlBodyScanAnalysis({
            ...scanInput,
            requestId,
            log
        });

        await setCachedBodyScanAnalysis({
            scanInput,
            result,
            requestId,
            log
        });

        return {
            ...result,
            meta: {
                ...(result.meta || {}),
                cacheHit: false
            }
        };
    } catch (error) {
        log?.warn(
            {
                event: 'fit.body_scan.failure',
                requestId,
                statusCode: error?.statusCode || 503,
                message: error?.message || 'Unknown body scan failure'
            },
            'Body scan analysis failed'
        );

        if (Number(error?.statusCode || 0) === 422) {
            throw createBodyScanError('We could not read that scan. Please retake it with better lighting and framing.', 422);
        }

        throw createBodyScanError('Camera-based body scan is temporarily unavailable. Please use manual measurements instead.', 503);
    }
};

export { analyzeBodyScan };
