# WhatsApp Transactional Notifications

This backend sends WhatsApp template messages for these order events:

- `Order Placed`
- `Out for delivery`
- `Delivered`

## Required Meta setup

Create and approve three WhatsApp templates in WhatsApp Manager:

- `order_placed`
- `order_out_for_delivery`
- `order_delivered`

Each template should define four body placeholders in this exact order:

1. Customer name
2. Order code
3. Order amount
4. Delivery status

Example body:

```text
Hi {{1}}, your order {{2}} for {{3}} is now {{4}}.
```

## Required environment variables

Configure these in `server/.env`:

```env
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TEMPLATE_ORDER_PLACED=order_placed
WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY=order_out_for_delivery
WHATSAPP_TEMPLATE_DELIVERED=order_delivered
WHATSAPP_TEMPLATE_LANGUAGE_CODE=en_US
WHATSAPP_GRAPH_API_VERSION=v25.0
WHATSAPP_DEFAULT_COUNTRY_CODE=91
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_NOTIFICATION_LOCK_TTL_MS=90000
WHATSAPP_MAX_RETRIES=2
```

## Webhook configuration

Configure the WhatsApp webhook callback URL to:

```text
https://<your-api-domain>/api/webhooks/whatsapp
```

Use the same value for the Meta verify token and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

If `WHATSAPP_APP_SECRET` is configured, webhook requests must include a valid `x-hub-signature-256` signature.

## Phone number expectations

The service normalizes recipient numbers before sending:

- It strips spaces, `+`, and punctuation.
- If a 10-digit local number is stored, it prefixes `WHATSAPP_DEFAULT_COUNTRY_CODE`.
- If no default is configured and the order country is `India` or `IN`, it falls back to `91`.

For best results, store customer numbers in international format.
