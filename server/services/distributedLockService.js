import { randomUUID } from 'crypto';
import distributedLockModel from '../models/distributedLockModel.js';

const DEFAULT_LOCK_TTL_MS = 60_000;

const parsePositiveInteger = (value, fallbackValue) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallbackValue;
};

const getLockTtlMs = (ttlMs) => parsePositiveInteger(ttlMs, DEFAULT_LOCK_TTL_MS);

const buildLockExpiryDate = (ttlMs) => new Date(Date.now() + getLockTtlMs(ttlMs));

const acquireDistributedLock = async ({ key, ownerId = randomUUID(), ttlMs, metadata = {} } = {}) => {
    const now = new Date();
    const expiresAt = buildLockExpiryDate(ttlMs);

    try {
        const lock = await distributedLockModel.findOneAndUpdate(
            {
                key,
                $or: [
                    { expiresAt: null },
                    { expiresAt: { $exists: false } },
                    { expiresAt: { $lte: now } }
                ]
            },
            {
                $set: {
                    ownerId,
                    expiresAt,
                    metadata,
                    lastAcquiredAt: now
                }
            },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true
            }
        );

        return {
            acquired: Boolean(lock && String(lock.ownerId) === String(ownerId)),
            ownerId,
            lock
        };
    } catch (error) {
        if (error?.code === 11000) {
            const currentLock = await distributedLockModel.findOne({ key }).lean();
            return {
                acquired: false,
                ownerId,
                lock: currentLock
            };
        }

        throw error;
    }
};

const releaseDistributedLock = async ({ key, ownerId, metadata = {} } = {}) => {
    if (!key || !ownerId) {
        return false;
    }

    const releasedLock = await distributedLockModel.findOneAndUpdate(
        {
            key,
            ownerId
        },
        {
            $set: {
                ownerId: '',
                expiresAt: new Date(0),
                metadata,
                lastReleasedAt: new Date()
            }
        },
        { new: true }
    );

    return Boolean(releasedLock);
};

const getDistributedLock = async (key) => {
    if (!key) {
        return null;
    }

    return distributedLockModel.findOne({ key }).lean();
};

export {
    acquireDistributedLock,
    getDistributedLock,
    releaseDistributedLock
};
