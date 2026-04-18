import mongoose from 'mongoose';

const systemJobStateSchema = new mongoose.Schema(
    {
        jobKey: { type: String, required: true, unique: true, trim: true },
        provider: { type: String, default: '', trim: true, index: true },
        jobType: { type: String, default: '', trim: true, index: true },
        lastRunStatus: {
            type: String,
            enum: ['idle', 'running', 'completed', 'failed', 'skipped'],
            default: 'idle',
            index: true
        },
        lastRunStartedAt: { type: Date, default: null },
        lastRunFinishedAt: { type: Date, default: null },
        lastSuccessfulRunAt: { type: Date, default: null },
        lastFailedRunAt: { type: Date, default: null },
        lastSkippedRunAt: { type: Date, default: null },
        lastTrigger: { type: String, default: '', trim: true },
        lastRequestedBy: { type: String, default: '', trim: true },
        lastRunDurationMs: { type: Number, default: 0, min: 0 },
        lastClaimedCount: { type: Number, default: 0, min: 0 },
        lastProcessedCount: { type: Number, default: 0, min: 0 },
        lastRetryScheduledCount: { type: Number, default: 0, min: 0 },
        lastConfig: { type: Object, default: null },
        lastMetricsBefore: { type: Object, default: null },
        lastMetricsAfter: { type: Object, default: null },
        lastRunResult: { type: Object, default: null },
        lastError: { type: String, default: '', trim: true, maxlength: 1000 },
        activeRunOwnerId: { type: String, default: '', trim: true },
        activeRunExpiresAt: { type: Date, default: null }
    },
    {
        timestamps: true,
        minimize: false
    }
);

const systemJobStateModel =
    mongoose.models.system_job_state ||
    mongoose.model('system_job_state', systemJobStateSchema);

export default systemJobStateModel;
