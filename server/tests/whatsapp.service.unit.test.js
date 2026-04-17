import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.WHATSAPP_ACCESS_TOKEN = 'wa_test_token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '980132085193608';
process.env.WHATSAPP_TEMPLATE_ORDER_PLACED = 'order_placed';
process.env.WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY = 'order_out_for_delivery';
process.env.WHATSAPP_TEMPLATE_DELIVERED = 'order_delivered';
process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE = 'en_US';
process.env.WHATSAPP_GRAPH_API_VERSION = 'v25.0';
process.env.WHATSAPP_DEFAULT_COUNTRY_CODE = '91';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'wa_verify_token';
process.env.WHATSAPP_APP_SECRET = 'wa_app_secret';
process.env.WHATSAPP_MAX_RETRIES = '1';

const orderModelMock = {
    findByIdAndUpdate: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn()
};

const loggerChildMock = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
};

const loggerMock = {
    child: vi.fn(() => loggerChildMock)
};

vi.mock('../models/orderModel.js', () => ({
    default: orderModelMock
}));

vi.mock('../config/logger.js', () => ({
    default: loggerMock
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const {
    handleWhatsAppWebhookEvent,
    handleWhatsAppWebhookVerification,
    sendOrderPlacedMessage
} = await import('../services/whatsappService.js');

const createRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    res.send = vi.fn(() => res);
    res.sendStatus = vi.fn(() => res);
    return res;
};

const createOrder = () => ({
    _id: '507f1f77bcf86cd799439011',
    amount: 260,
    address: {
        firstName: 'Sunny',
        lastName: 'Maurya',
        phone: '9988073907',
        country: 'India'
    }
});

describe('whatsappService', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        orderModelMock.findByIdAndUpdate.mockReset();
        orderModelMock.findOne.mockReset();
        orderModelMock.findOneAndUpdate.mockReset();
        loggerMock.child.mockClear();
        loggerChildMock.debug.mockClear();
        loggerChildMock.error.mockClear();
        loggerChildMock.info.mockClear();
        loggerChildMock.warn.mockClear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('sends a template notification, prefixes the default country code, and stores the message id', async () => {
        const order = createOrder();

        orderModelMock.findOneAndUpdate.mockResolvedValueOnce(order);
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                messages: [{ id: 'wamid.test.placed' }]
            })
        });
        orderModelMock.findByIdAndUpdate.mockResolvedValueOnce({
            ...order,
            whatsappNotifications: {
                placedSent: true,
                placedMessageId: 'wamid.test.placed'
            }
        });

        const result = await sendOrderPlacedMessage(order);

        expect(result).toEqual({
            success: true,
            skipped: false,
            messageId: 'wamid.test.placed'
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [endpoint, requestOptions] = fetchMock.mock.calls[0];
        const payload = JSON.parse(requestOptions.body);

        expect(endpoint).toBe('https://graph.facebook.com/v25.0/980132085193608/messages');
        expect(requestOptions.headers.Authorization).toBe('Bearer wa_test_token');
        expect(payload).toEqual(
            expect.objectContaining({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: '919988073907',
                type: 'template',
                template: expect.objectContaining({
                    name: 'order_placed',
                    language: { code: 'en_US' }
                })
            })
        );
        expect(payload.template.components[0].parameters.map((parameter) => parameter.text)).toEqual([
            'Sunny Maurya',
            'LF-99439011',
            '260',
            'Order placed'
        ]);
        expect(orderModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
            '507f1f77bcf86cd799439011',
            expect.objectContaining({
                $set: expect.objectContaining({
                    'whatsappNotifications.placedSent': true,
                    'whatsappNotifications.placedMessageId': 'wamid.test.placed',
                    'whatsappNotifications.placedWebhookStatus': 'accepted'
                })
            }),
            { new: true }
        );
    });

    it('skips duplicate sends when a notification is already sent or in flight', async () => {
        orderModelMock.findOneAndUpdate.mockResolvedValueOnce(null);

        const result = await sendOrderPlacedMessage(createOrder());

        expect(result).toEqual({
            success: true,
            skipped: true,
            reason: 'already_sent_or_in_flight'
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns a failure result and clears the send lock when Meta returns an error', async () => {
        const order = createOrder();

        orderModelMock.findOneAndUpdate.mockResolvedValueOnce(order);
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => JSON.stringify({
                error: {
                    message: 'Server unavailable'
                }
            })
        });
        orderModelMock.findByIdAndUpdate.mockResolvedValueOnce(order);

        const result = await sendOrderPlacedMessage(order);

        expect(result.success).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('WhatsApp API 500');
        expect(orderModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
            '507f1f77bcf86cd799439011',
            expect.objectContaining({
                $set: expect.objectContaining({
                    'whatsappNotifications.placedSending': false,
                    'whatsappNotifications.placedLockExpiresAt': null
                })
            }),
            { new: true }
        );
    });

    it('does not throw when the notification lock query fails', async () => {
        orderModelMock.findOneAndUpdate.mockRejectedValueOnce(new Error('database unavailable'));
        orderModelMock.findByIdAndUpdate.mockResolvedValueOnce(null);

        await expect(sendOrderPlacedMessage(createOrder())).resolves.toEqual(
            expect.objectContaining({
                success: false,
                skipped: false,
                error: 'database unavailable'
            })
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('verifies the webhook challenge token', async () => {
        const req = {
            query: {
                'hub.mode': 'subscribe',
                'hub.challenge': '12345',
                'hub.verify_token': 'wa_verify_token'
            }
        };
        const res = createRes();

        await handleWhatsAppWebhookVerification(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('12345');
    });

    it('validates signed webhook events and records the delivery status by message id', async () => {
        orderModelMock.findOne.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            whatsappNotifications: {
                placedMessageId: 'wamid.test.known',
                placedLastError: ''
            }
        });
        orderModelMock.findByIdAndUpdate.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011'
        });

        const webhookBody = JSON.stringify({
            object: 'whatsapp_business_account',
            entry: [
                {
                    changes: [
                        {
                            value: {
                                statuses: [
                                    {
                                        id: 'wamid.test.known',
                                        status: 'delivered',
                                        timestamp: '1711111111'
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        });
        const signature = `sha256=${crypto
            .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
            .update(Buffer.from(webhookBody))
            .digest('hex')}`;
        const req = {
            body: JSON.parse(webhookBody),
            headers: {
                'x-hub-signature-256': signature
            },
            log: loggerMock,
            rawBody: Buffer.from(webhookBody)
        };
        const res = createRes();

        await handleWhatsAppWebhookEvent(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ received: true });
        expect(orderModelMock.findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                $or: expect.arrayContaining([
                    { 'whatsappNotifications.placedMessageId': 'wamid.test.known' }
                ])
            })
        );
        expect(orderModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
            '507f1f77bcf86cd799439011',
            expect.objectContaining({
                $set: expect.objectContaining({
                    'whatsappNotifications.placedWebhookStatus': 'delivered',
                    'whatsappNotifications.placedWebhookTimestamp': 1711111111000
                })
            })
        );
    });
});
