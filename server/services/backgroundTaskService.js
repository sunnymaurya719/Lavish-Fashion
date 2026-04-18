import logger from '../config/logger.js';

const resolveWaitUntil = ({ waitUntil } = {}) => {
    if (typeof waitUntil === 'function') {
        return waitUntil;
    }

    if (typeof globalThis.waitUntil === 'function') {
        return globalThis.waitUntil.bind(globalThis);
    }

    return null;
};

const runBackgroundTask = (taskFactory, { taskName = 'background_task', waitUntil = null, log } = {}) => {
    const taskLog = log?.child
        ? log.child({ taskName })
        : logger.child({ taskName });

    const executeTask = async () => {
        try {
            await taskFactory();
        } catch (error) {
            taskLog.error(
                {
                    err: error,
                    errorMessage: error?.message || `${taskName} failed`
                },
                'Background task failed'
            );
        }
    };

    const serverlessWaitUntil = resolveWaitUntil({ waitUntil });

    if (serverlessWaitUntil) {
        serverlessWaitUntil(executeTask());
        return 'waitUntil';
    }

    if (typeof setImmediate === 'function') {
        setImmediate(() => {
            void executeTask();
        });
        return 'setImmediate';
    }

    queueMicrotask(() => {
        void executeTask();
    });
    return 'queueMicrotask';
};

export { runBackgroundTask };
