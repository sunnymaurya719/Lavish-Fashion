import {
    createAdminRealtimeTokenRequest,
    isRealtimeConfigured,
    isRealtimeEnabled
} from '../services/realtimeService.js';

const getAdminRealtimeToken = async (req, res) => {
    try {
        if (!isRealtimeEnabled()) {
            return res.status(503).json({
                success: false,
                message: 'Realtime is disabled on server'
            });
        }

        if (!isRealtimeConfigured()) {
            return res.status(503).json({
                success: false,
                message: 'Realtime is not configured'
            });
        }

        const tokenRequest = await createAdminRealtimeTokenRequest({
            adminEmail: req.admin?.email
        });

        return res.status(200).json({
            success: true,
            tokenRequest
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to create admin realtime token request');
        return res.status(500).json({
            success: false,
            message: 'Failed to create realtime auth token'
        });
    }
};

export { getAdminRealtimeToken };
