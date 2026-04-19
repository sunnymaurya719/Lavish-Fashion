# WhatsApp Transactional Notifications

Lavish Fashion sends **exactly three** customer-facing WhatsApp template
messages per order. They are wired end-to-end with the Shiprocket integration
so that any status change pushed by Shiprocket updates the admin order list
and (where applicable) triggers the matching WhatsApp template.

## The three notifications

| Trigger                                      | Local order status     | WhatsApp template env                  |
| -------------------------------------------- | ---------------------- | -------------------------------------- |
| Order successfully created (COD or paid)     | `Order Placed`         | `WHATSAPP_TEMPLATE_ORDER_PLACED`       |
| Shiprocket reports `Out For Delivery`        | `Out for delivery`     | `WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY`   |
| Shiprocket reports `Delivered`               | `Delivered`            | `WHATSAPP_TEMPLATE_DELIVERED`          |

Other Shiprocket statuses (Pickup Scheduled, Shipped, In Transit, RTO,
Cancelled, etc.) still update the order's `shiprocket.*` fields **and** the
local `status` so the admin Orders page reflects the latest fulfillment state
in real time, but they do not send a WhatsApp message.

## Status alignment with Shiprocket

`server/services/shiprocketWebhookService.js` maps incoming Shiprocket events
to the local order status via `resolveShiprocketLocalStatus`:

- `Out For Delivery` -> `Out for delivery`
- `Delivered`        -> `Delivered`
- `Cancelled`        -> `Cancelled`
- `Shipped` / `In Transit` / `Dispatched` -> `Shipped`

The mapped status is fed into `applyOrderStatusTransition`, which:

1. updates the order document (`status`, `deliveredAt`, `shiprocket.*`),
2. publishes an admin realtime upsert (`publishAdminOrderUpsert`) so the
   admin Orders page flips to the new status without a refresh, and
3. dispatches the matching WhatsApp template through
   `sendStatusDrivenWhatsAppNotification` - which only fires for
   `Out for delivery` and `Delivered` (placed is sent at order creation).

Idempotency is guaranteed by `acquireNotificationLock` plus the
`whatsappNotifications.<event>Sent` flag on the order, so duplicate or
out-of-order Shiprocket webhooks never produce duplicate WhatsApp messages.

## Required Meta setup

Create and approve **three** WhatsApp templates in WhatsApp Manager:

- `order_placed`
- `order_out_for_delivery`
- `order_delivered`

Each template must define four body placeholders in this exact order:

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

`WHATSAPP_TEMPLATE_ORDER_SHIPPED` and `WHATSAPP_TEMPLATE_ORDER_CANCELLED`
are intentionally not used - keep them out of the env to avoid confusion.

## Webhook configuration

Configure the WhatsApp webhook callback URL to:

```text
https://<your-api-domain>/api/webhooks/whatsapp
```

Use the same value for the Meta verify token and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

If `WHATSAPP_APP_SECRET` is configured, webhook requests must include a valid
`x-hub-signature-256` signature.

## Phone number expectations

The service normalizes recipient numbers before sending:

- It strips spaces, `+`, and punctuation.
- If a 10-digit local number is stored, it prefixes
  `WHATSAPP_DEFAULT_COUNTRY_CODE`.
- If no default is configured and the order country is `India` or `IN`, it
  falls back to `91`.

For best results, store customer numbers in international format.
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
