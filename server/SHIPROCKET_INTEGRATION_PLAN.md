# Shiprocket Integration Plan

This document turns the raw Shiprocket integration idea into an implementation plan that fits the current `server/` codebase in this repository.

It is written for the existing stack:

- Node.js
- Express 5
- MongoDB + Mongoose
- Zod validation
- Pino logger
- Existing order lifecycle with COD, Stripe, Razorpay, WhatsApp, and webhooks

## Goal

Add a production-safe Shiprocket integration that:

- refreshes Shiprocket auth tokens automatically
- creates Shiprocket orders from local Lavish Fashion orders
- tracks shipments by AWB
- processes Shiprocket webhooks
- sends WhatsApp status updates
- does not break checkout if Shiprocket is temporarily unavailable

## Important Repo Reality

The project already has these building blocks:

- `server/config/env.js`
- `server/config/logger.js`
- `server/middleware/errorHandler.js`
- `server/routes/orderRoute.js`
- `server/routes/webhookRoute.js`
- `server/controllers/orderController.js`
- `server/services/whatsappService.js`
- `server/models/orderModel.js`
- `server/services/idempotencyService.js`

Because of that, the safest implementation is to plug Shiprocket into the existing architecture instead of creating a second parallel order system.

## Requested Architecture vs Current Repo

The raw brief asked for this structure:

- `/config/shiprocket.js`
- `/services/shiprocket.service.js`
- `/services/whatsapp.service.js`
- `/controllers/order.controller.js`
- `/routes/order.routes.js`
- `/middlewares/error.middleware.js`
- `/utils/logger.js`

In this repo, the correct mapped structure should be:

- `server/config/shiprocket.js`
- `server/services/shiprocketService.js`
- `server/services/whatsappService.js`
- `server/controllers/orderController.js`
- `server/routes/orderRoute.js`
- `server/routes/webhookRoute.js`
- `server/middleware/errorHandler.js`
- `server/config/logger.js`

Do not create a second logger utility under `utils/` because the repo already uses `server/config/logger.js`.

## Official API References

Use these official references while implementing:

- Shiprocket API docs: https://apidocs.shiprocket.in/
- Shiprocket official Postman collection: https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace/documentation/qu05zax/shiprocket-api
- Shiprocket tracking folder: https://www.postman.com/shiprocketdev/workspace/shiprocket-dev-s-public-workspace/folder/8407119-12b1cc4b-de0b-436b-ac5b-359f62f3514b
- Shiprocket orders folder: https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace/folder/d9h07rl/orders
- Meta official WhatsApp workspace: https://www.postman.com/meta/workspace/whatsapp-business-platform
- Meta webhook payload reference: https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-165404ee-a204-40ce-8e34-e3916a8053c8

## Shiprocket Endpoints We Actually Need

Based on the official Shiprocket docs, the core endpoints for this version are:

- `POST /auth/login`
- `POST /orders/create/adhoc`
- `GET /orders/show/:orderId`
- `GET /courier/track/awb/:awb_code`
- `GET /orders?search=<reference>` for reconciliation and duplicate-safe recovery

Notes:

- The official Shiprocket create-order endpoint for custom orders is `/orders/create/adhoc`.
- A create-order response can return `awb_code: null`. That is normal at creation time and should not be treated as a failure.
- Tracking by AWB is a separate call and usually becomes useful after the AWB exists.

## Confirmed Doc Constraints That Affect This Repo

These are the important official-doc details that materially affect how we implement this in the current backend.

### 1. Shiprocket token validity and our refresh policy are not the same thing

Shiprocket's official docs describe the auth token as valid for 10 days.

Your brief asked for:

- in-memory token storage
- treat token as expiring at 24 hours
- refresh at 23 hours

That is fine as an application-level safety policy, but the code and plan should describe it correctly:

- official Shiprocket validity is longer
- Lavish Fashion will intentionally rotate earlier

So the final code should avoid comments like "Shiprocket token expires in 24 hours" and instead say:

- "Lavish Fashion refreshes the Shiprocket token every 23 hours by policy"

### 2. Shiprocket order ids are seller-defined and have length constraints

The official docs for order creation and specific-order lookup use a seller-supplied `order_id`, and the docs note a max length of 20 characters for that field.

This matters because the current backend uses Mongo ObjectIds for local orders, and those are 24 characters long.

That means:

- do not send `String(order._id)` directly as Shiprocket `order_id`
- create and persist a separate short reference code for Shiprocket, max 20 chars

### 3. Duplicate-safe reconciliation needs a stable reference

Shiprocket's order listing docs support `GET /orders` with a `search` parameter for AWB or channel order id.

That gives us a safe recovery pattern:

1. generate a stable local `shiprocket.referenceOrderId`
2. use that exact value in every create attempt
3. if a create call times out or returns an ambiguous upstream failure, reconcile by searching Shiprocket for that same reference before retrying

Without that, network retries can create duplicate Shiprocket orders.

### 4. Webhook auth cannot be assumed from the raw brief

The raw brief said to add `/api/webhooks/shiprocket`, but it did not specify how Shiprocket will authenticate calls.

Official Shiprocket material shows callback-style setups where a header key and header value can be configured, but that depends on the product/account setup you are using.

So the plan must treat webhook verification as configurable, not guaranteed.

Also, the public docs reviewed here are much clearer on auth, order creation, order lookup, tracking, and order search than on a canonical external webhook payload example.

So before locking the final webhook Zod schema, capture one real Shiprocket webhook payload in staging and validate the schema against that exact shape.

### 5. `getOrder(orderId)` must use the Shiprocket order id, not the local Mongo id

The official "Get Specific Order Details" endpoint expects the Shiprocket-side order id in `/orders/show/{id}`.

So once synced, the local order must store at least:

- `shiprocket.orderId`
- `shiprocket.shipmentId`
- `shiprocket.referenceOrderId`
- `shiprocket.awbCode`

## Production Design Decisions

These are the key design choices that make the integration production-ready inside this app.

### 1. Keep local order creation authoritative

Lavish Fashion should always create and save its own local order first.

Do not make checkout success depend completely on Shiprocket being up.

Recommended behavior:

- local order save succeeds
- Shiprocket sync is attempted immediately after
- if Shiprocket fails, store `shiprocket.syncStatus = "pending_retry"` and log the failure
- return success for the local order so checkout does not fail because a shipping vendor is down

### 2. Shiprocket sync timing must follow payment status

This repo already supports three flows:

- COD order creation
- Stripe checkout
- Razorpay checkout

Shiprocket order creation should happen only when the local order is truly ready for fulfillment:

- COD: after the local COD order is created
- Stripe: after payment is confirmed and the local order is created/marked paid
- Razorpay: after payment is confirmed and the local order is created/marked paid

In this repo that means Shiprocket sync belongs inside shared post-order helpers, not only inside a new `/api/orders/create` route.

Recommended integration points:

- `placeOrderCOD`
- `createOrderFromPaymentAttempt`
- `markOrderAsPaid`

### 3. In-memory token cache is acceptable for this backend

The brief requires in-memory token storage. That is acceptable here, with one important note:

- every Node process will hold its own Shiprocket token cache

That is fine for a normal multi-instance deployment, but you should expect:

- one token refresh per instance
- more refreshes on cold starts in serverless environments

That is still compatible with the requested design.

Implementation note:

- use the 23-hour refresh threshold because that is the requested Lavish policy
- do not claim that this threshold comes from Shiprocket docs

### 4. Webhooks must be idempotent

Shiprocket webhooks can be delivered more than once or arrive out of order.

Do not update an order blindly on every webhook receipt.

Recommended dedupe key:

- `shipment_id + current_status + event_time`

If the webhook payload does not contain a stable event id, hash the payload and store the hash in a dedicated webhook event collection.

Do not reuse the current idempotency model for this:

- `server/models/idempotencyKeyModel.js` requires `userId`
- Shiprocket webhooks are system-to-system events, not user-scoped requests

### 5. WhatsApp template names should not be hardcoded

The brief only listed access token and phone number ID, but a production system also needs template-name configuration.

Recommended env additions:

- `WHATSAPP_TEMPLATE_ORDER_PLACED`
- `WHATSAPP_TEMPLATE_ORDER_SHIPPED`
- `WHATSAPP_TEMPLATE_ORDER_OUT_FOR_DELIVERY`
- `WHATSAPP_TEMPLATE_ORDER_DELIVERED`
- `WHATSAPP_TEMPLATE_ORDER_CANCELLED`
- `WHATSAPP_TEMPLATE_LANGUAGE_CODE`

The existing repo already uses env-driven template names for WhatsApp. Keep that pattern.

Also note the current backend only tracks these WhatsApp notification types:

- `placed`
- `outForDelivery`
- `delivered`

If you want Shiprocket webhook-driven notifications for:

- shipped
- cancelled

then both `orderModel.js` and `whatsappService.js` must be extended to support those additional notification states.

## Missing Data Gaps You Must Solve Before Coding

The current order model is close, but Shiprocket needs some fulfillment fields that are not fully present in the local order snapshot today.

### 0. Stable short Shiprocket reference order id

This is the biggest mismatch between the docs and the current backend.

Current state:

- local order ids are Mongo ObjectIds
- Shiprocket `order_id` is seller-defined and documented with a max length of 20 characters

Recommended fix:

- add a stable `shiprocket.referenceOrderId` or `publicOrderCode` to the local order
- generate it once when the local order is created
- keep it under 20 characters
- reuse it for all Shiprocket create/retry/reconciliation calls

Example shape:

- `LF` + base36 timestamp + 4-char random suffix

Do not derive it differently on every retry.

### 1. SKU

Shiprocket order items expect SKU values.

Current state:

- `productModel` has `sku`
- `orderModel.items` does not store `sku`

Recommended fix:

- persist `sku` into the order item snapshot at checkout time
- persist the same `sku` into `paymentAttemptModel` item snapshots too

Why:

- if product SKU changes later, old order sync should still use the original SKU
- prepaid flows in this repo create the final order from `paymentAttemptModel`, so both models must carry the same immutable snapshot data

Important current-backend detail:

- `productModel` has `sku`
- `productAddSchema` and `productUpdateSchema` still make `sku` optional

That means Shiprocket rollout needs one of these choices:

1. backfill all products with SKUs and make SKU effectively required for shippable products
2. derive a fallback SKU pattern when missing

For production, option 1 is better.

### 2. Customer email

Shiprocket order creation expects billing/shipping email.

Current state:

- `order.address` does not include email

Recommended fix:

- either persist `customerEmail` onto the order at creation time
- or load it from `userModel` during Shiprocket sync

Preferred:

- store it on the order snapshot so the fulfillment payload stays immutable
- store it on `paymentAttemptModel` too for prepaid flows

### 3. Package dimensions and weight

Shiprocket order creation expects:

- `length`
- `breadth`
- `height`
- `weight`

Current state:

- `productModel` does not hold shipping dimensions
- `orderModel` does not hold parcel dimensions

Recommended fix:

- add default env values as a fallback:
  - `SHIPROCKET_DEFAULT_LENGTH_CM`
  - `SHIPROCKET_DEFAULT_BREADTH_CM`
  - `SHIPROCKET_DEFAULT_HEIGHT_CM`
  - `SHIPROCKET_DEFAULT_WEIGHT_KG`
- later add product-level shipping dimensions if precision is required

For the first production version, default parcel dimensions are acceptable if all products ship in a similar package class.

### 4. HSN and tax

Shiprocket supports `hsn` and `tax` fields per order item.

If those matter for invoicing/compliance in your workflow, add them to product and order snapshots. If not, keep them empty in v1.

### 5. Webhook dedupe storage

Current state:

- there is an idempotency model, but it is tied to `userId`
- there is no generic integration-event storage model yet

Recommended fix:

- add a dedicated model such as `server/models/shiprocketWebhookEventModel.js`

Recommended fields:

- `provider`
- `eventKey`
- `shipmentId`
- `orderId`
- `awbCode`
- `status`
- `receivedAt`
- `payloadHash`
- `rawPayload`

Use a unique index on `eventKey`.

## Environment Variables

These values belong in `server/.env`, not `admin/.env`.

Recommended approach for this repo:

- add `SHIPROCKET_ENABLED=true|false`
- validate Shiprocket credentials only when the feature is enabled

Why:

- `server/config/env.js` currently throws hard on missing required env vars
- if Shiprocket is added as always-required before rollout, it can break unrelated local dev, CI, or test environments

### Required for Shiprocket

```env
SHIPROCKET_ENABLED=true
SHIPROCKET_EMAIL=
SHIPROCKET_PASSWORD=
SHIPROCKET_BASE_URL=https://apiv2.shiprocket.in/v1/external
SHIPROCKET_PICKUP_LOCATION=
```

### Strongly recommended for Shiprocket

```env
SHIPROCKET_TIMEOUT_MS=10000
SHIPROCKET_TOKEN_TTL_MS=86400000
SHIPROCKET_TOKEN_REFRESH_AFTER_MS=82800000
SHIPROCKET_DEFAULT_LENGTH_CM=30
SHIPROCKET_DEFAULT_BREADTH_CM=20
SHIPROCKET_DEFAULT_HEIGHT_CM=8
SHIPROCKET_DEFAULT_WEIGHT_KG=0.5
SHIPROCKET_WEBHOOK_SECRET=
SHIPROCKET_WEBHOOK_TOKEN=
```

### Required for WhatsApp

```env
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_API_URL=https://graph.facebook.com/v25.0
WHATSAPP_TEMPLATE_LANGUAGE_CODE=en_US
```

### Strongly recommended for WhatsApp templates

```env
WHATSAPP_TEMPLATE_ORDER_PLACED=order_placed
WHATSAPP_TEMPLATE_ORDER_SHIPPED=order_shipped
WHATSAPP_TEMPLATE_ORDER_OUT_FOR_DELIVERY=order_out_for_delivery
WHATSAPP_TEMPLATE_ORDER_DELIVERED=order_delivered
WHATSAPP_TEMPLATE_ORDER_CANCELLED=order_cancelled
```

## Changes Needed In This Backend

This is the concrete repo-specific change list.

### New files

- `server/config/shiprocket.js`
  - token cache, refresh lock, invalidate helper
- `server/services/shiprocketService.js`
  - Axios client, authenticated requests, 401 retry, reconciliation helpers
- `server/models/shiprocketWebhookEventModel.js`
  - webhook dedupe and audit storage

### Existing files that must change

- `server/package.json`
  - add Axios as a direct dependency
- `server/config/env.js`
  - add conditional Shiprocket env validation behind `SHIPROCKET_ENABLED`
- `server/config/logger.js`
  - no structural rewrite needed, just use child loggers for Shiprocket context
- `server/services/checkoutPricingService.js`
  - include immutable snapshot fields like `sku` in `normalizedItems`
- `server/models/orderModel.js`
  - add `customerEmail`
  - add `shiprocket.referenceOrderId`
  - add full `shiprocket` status object
  - extend `whatsappNotifications` if shipped/cancelled messaging is required
- `server/models/paymentAttemptModel.js`
  - add `customerEmail`
  - add `sku` and any immutable shipment metadata needed later
- `server/models/productModel.js`
  - either require `sku` for shippable products or plan a fallback rule
  - optionally add package dimensions and weight for better parcel accuracy
- `server/validation/schemas.js`
  - add Shiprocket webhook schema and any manual retry/test route schemas
- `server/controllers/orderController.js`
  - call Shiprocket sync after local order creation or payment confirmation
  - add webhook handler or delegate to a dedicated integration controller
  - add shipped/cancelled notification hooks if desired
- `server/services/whatsappService.js`
  - add generic `sendTemplateMessage`
  - optionally add `shipped` and `cancelled` notification types
- `server/routes/webhookRoute.js`
  - add `POST /shiprocket` with route-local JSON parsing
- `server/routes/orderRoute.js`
  - add retry or inspection routes if needed
- `server/controllers/systemController.js`
  - expose Shiprocket integration health in bootstrap
- `server/routes/systemRoute.js`
  - optionally add a safe Shiprocket test endpoint here instead of inventing a separate router

### Files that probably do not need structural change

- `server/middleware/errorHandler.js`
  - keep centralized error handling, just support normalized upstream errors
- `server/app.js`
  - current webhook mount order is already correct for adding another provider webhook
- `server/middleware/requestLogger.js`
  - already gives `req.log` and `requestId`, which is enough for Shiprocket logging

## File-by-File Implementation Plan

## 1. `server/package.json`

Add Axios as a direct dependency if it is not already declared explicitly.

```json
{
  "dependencies": {
    "axios": "^1.x"
  }
}
```

Why:

- the brief explicitly requires Axios
- direct declaration is clearer than relying on a transitive dependency

## 2. `server/config/env.js`

Extend environment validation.

Add Shiprocket vars, but validate them conditionally when `SHIPROCKET_ENABLED=true`.

Required when enabled:

- `SHIPROCKET_EMAIL`
- `SHIPROCKET_PASSWORD`
- `SHIPROCKET_BASE_URL`
- `SHIPROCKET_PICKUP_LOCATION`

Add optional-but-recommended vars:

- timeout
- token refresh thresholds
- default dimensions
- webhook secret or token

Also add `WHATSAPP_API_URL` if you want that URL to be configurable instead of constructing it from version parts.

Also update `server/controllers/systemController.js` so `/api/system/bootstrap` exposes:

- `shiprocketEnabled`
- `shiprocketConfigured`

## 3. `server/config/shiprocket.js`

Create the token manager here.

Responsibilities:

- keep Shiprocket token in memory
- keep token creation timestamp
- refresh after 23 hours
- prevent duplicate parallel refresh requests
- expose helpers for invalidation and retry

Recommended exports:

- `generateToken({ force = false } = {})`
- `getValidToken()`
- `invalidateToken()`

Recommended internal state:

```js
let cachedToken = '';
let tokenCreatedAt = 0;
let refreshPromise = null;
```

Recommended logic:

1. If a refresh is already in flight, await the same promise.
2. If token exists and age is below refresh threshold, return it.
3. Otherwise call `POST /auth/login`.
4. Store the new token and `Date.now()`.
5. Log refresh success and failure through `logger.child({ integration: 'shiprocket' })`.

Recommended error behavior:

- if login fails, throw an error with `statusCode = 502`
- do not leak Shiprocket credentials or raw auth payloads into logs

## 4. `server/services/shiprocketService.js`

This file should own all Shiprocket HTTP calls.

Recommended public methods:

- `createOrder(orderData)`
- `getOrder(orderId)`
- `trackShipment(awb)`
- `findOrdersByReference(referenceOrderId)`
- `syncOrderToShiprocket(localOrder, options = {})`

Recommended private helpers:

- `createShiprocketClient()`
- `requestWithAuth(config, { retryOn401 = true } = {})`
- `normalizeShiprocketError(error, fallbackMessage)`
- `mapLocalOrderToShiprocketPayload(order, user)`
- `reconcileExistingShiprocketOrder(referenceOrderId)`

### `requestWithAuth` behavior

Required behavior:

1. call `getValidToken()`
2. send request with `Authorization: Bearer <token>`
3. if Shiprocket responds `401`, call `invalidateToken()`
4. fetch a new token
5. retry the request exactly once
6. if it still fails, throw a normalized upstream error

Client-facing behavior:

- do not return raw Shiprocket `401` to the frontend
- translate final upstream auth failures into `502` or `503`

### `createOrder(orderData)`

Use:

- `POST /orders/create/adhoc`

Return a normalized object like:

```js
{
  shiprocketOrderId,
  shipmentId,
  awbCode,
  courierCompanyId,
  courierName,
  status,
  statusCode,
  raw
}
```

### `getOrder(orderId)`

Use:

- `GET /orders/show/:orderId`

Important:

- `orderId` here means the Shiprocket order id returned by Shiprocket, not the local Mongo order id

Return a normalized order detail object that is easy to store on the local order.

### `trackShipment(awb)`

Use:

- `GET /courier/track/awb/:awb`

Return a normalized tracking object:

```js
{
  currentStatus,
  currentStatusCode,
  trackUrl,
  activities,
  raw
}
```

### `syncOrderToShiprocket(localOrder)`

This is the most important service helper.

Recommended flow:

1. if the order already has `shiprocket.shipmentId`, skip unless `force = true`
2. load any missing customer data needed for payload mapping
3. map local order to Shiprocket payload
4. call `createOrder`
5. update the local order with Shiprocket identifiers
6. set `shiprocket.syncStatus = "synced"`
7. if create fails, set `shiprocket.syncStatus = "pending_retry"` and save `lastError`

Ambiguous failure handling:

- if create times out or returns a transport-level error after request send, do not immediately create a second Shiprocket order
- first call `findOrdersByReference(referenceOrderId)` or equivalent reconciliation logic using `GET /orders?search=<reference>`
- only create again if reconciliation confirms the order does not exist remotely

This helper should be called by the order lifecycle, not by the frontend directly.

## 5. `server/services/whatsappService.js`

Do not replace the existing service. Extend it.

Add a generic export:

- `sendTemplateMessage({ to, templateName, parameters })`

Keep the existing wrapper methods:

- `sendOrderPlacedMessage`
- `sendShippedMessage` if you add shipped messaging
- `sendOutForDeliveryMessage`
- `sendDeliveredMessage`
- `sendCancelledMessage` if you add cancelled messaging

Recommended generic method behavior:

- accept a destination phone number in E.164-compatible digit form
- accept a template name from env or explicit caller input
- accept dynamic parameters as ordered text values
- use Axios or keep current fetch implementation if you do not want to refactor the existing tested service

Important note about the rupee symbol:

- the safest template body is `Hi {{1}}, your order {{2}} for \\u20B9{{3}} is now {{4}}.`
- pass only the numeric amount as parameter `{{3}}`
- do not send `\\u20B9` inside the parameter itself unless your template is designed that way

That avoids double-currency issues and reduces encoding surprises.

## 6. `server/models/orderModel.js`

Add Shiprocket fields as a nested object.

Recommended shape:

```js
shiprocket: {
  syncStatus: { type: String, enum: ['not_required', 'pending', 'synced', 'pending_retry', 'failed'], default: 'pending' },
  orderId: { type: Number, default: null, index: true },
  shipmentId: { type: Number, default: null, index: true },
  awbCode: { type: String, default: '', trim: true, index: true },
  courierCompanyId: { type: Number, default: null },
  courierName: { type: String, default: '', trim: true },
  status: { type: String, default: '', trim: true },
  statusCode: { type: Number, default: null },
  currentStatus: { type: String, default: '', trim: true },
  currentStatusCode: { type: Number, default: null },
  trackUrl: { type: String, default: '', trim: true },
  syncedAt: { type: Number, default: null },
  lastTrackedAt: { type: Number, default: null },
  lastWebhookAt: { type: Number, default: null },
  lastError: { type: String, default: '', trim: true, maxlength: 500 },
  rawCreateResponse: { type: Object, default: null },
  rawTrackingResponse: { type: Object, default: null }
}
```

Also consider extending order item snapshots with:

- `sku`
- `hsn`
- `tax`

Also add top-level immutable customer snapshot fields for fulfillment:

- `customerEmail`
- optionally `publicOrderCode` if you do not want it nested under `shiprocket`

Also expand `whatsappNotifications` if you plan to message on webhook statuses beyond the three current types.

Index recommendations:

- `shiprocket.orderId`
- `shiprocket.shipmentId`
- `shiprocket.awbCode`
- `shiprocket.syncStatus`

## 6A. `server/models/paymentAttemptModel.js`

Because prepaid orders in this repo are materialized later from payment attempts, Shiprocket-related snapshot fields must exist here too.

Add:

- `customerEmail`
- item-level `sku`
- optional item-level `hsn`
- optional item-level `tax`
- optional provisional `shiprocket.referenceOrderId` if you want the reference generated before final order creation

If you skip this, Stripe and Razorpay flows can lose data that COD orders still have.

## 6B. `server/models/shiprocketWebhookEventModel.js`

Create a dedicated event-dedupe model instead of overloading `idempotencyKeyModel`.

Recommended indexes:

- unique `eventKey`
- `shipmentId`
- `orderId`
- TTL on old events if you do not want unbounded growth

## 6C. `server/models/productModel.js`

Current state:

- `sku` exists
- parcel dimensions and weight do not

Recommended first version:

- backfill SKU for all sellable products
- keep parcel dimensions in env defaults

Recommended mature version:

- add `shipping.lengthCm`
- add `shipping.breadthCm`
- add `shipping.heightCm`
- add `shipping.weightKg`

## 7. `server/validation/schemas.js`

Add Zod schemas for:

- Shiprocket test route response safety if needed
- direct create route, if you expose `POST /api/orders/create`
- webhook payload parsing

Recommended schemas:

- `shiprocketCreateSchema`
- `shiprocketWebhookSchema`
- `shiprocketTrackParamsSchema`

Also update product validation strategy if SKU will become mandatory for Shiprocket-synced products.

Even if Shiprocket webhook payloads can vary, validate the fields you rely on:

- event name
- shipment id
- order id
- awb
- current status
- status id

## 8. `server/controllers/orderController.js`

Do not split core order flow away from the existing controller unless you are ready for a larger refactor.

Recommended additions:

- `createShiprocketOrderForLocalOrder`
- `testShiprocketConnection`
- `handleShiprocketWebhook`
- `retryShiprocketSync` (recommended extra admin endpoint)

### `POST /api/orders/create`

If you must support this exact route, make it a thin controller that:

1. validates request body
2. creates the local order
3. attempts Shiprocket sync
4. stores the order in Mongo
5. sends WhatsApp order-placed notification
6. returns both local and Shiprocket identifiers

However, for this repository, the better production design is:

- keep current checkout endpoints
- add shared internal Shiprocket sync after order persistence

Why this is important in the current backend:

- `placeOrderCOD`, `placeOrderStripe`, and `placeOrderRazorpay` already implement inventory reservation, loyalty redemption, idempotency, and payment flow control
- a new standalone create route can accidentally bypass those protections unless it becomes a thin alias over the same internal helpers

The plan should therefore treat `/api/orders/create` as optional compatibility surface, not the main integration point.

### `GET /api/test/shiprocket`

This route should:

1. call `getValidToken()`
2. never return the token string itself
3. return safe metadata only

Example safe response:

```json
{
  "success": true,
  "message": "Shiprocket token is valid",
  "tokenPresent": true
}
```

Alignment note:

- the current backend already has `systemRoute.js` and `systemController.js`
- for this repo, a system/integration test endpoint is cleaner than putting this under order routes
- if you must expose the exact path `/api/test/shiprocket`, add a tiny dedicated route module rather than mixing it into checkout routes

### `POST /api/webhooks/shiprocket`

Recommended controller flow:

1. parse and validate payload
2. verify shared secret or token if configured
3. dedupe the webhook
4. locate the local order by:
   - `shiprocket.shipmentId`
   - or `shiprocket.orderId`
   - or `shiprocket.awbCode`
5. map external status to local status
6. update `order.shiprocket.*`
7. update local `order.status`
8. send the correct WhatsApp notification
9. log the event
10. return `200` even for already-processed duplicates

Recommended status mapping:

- `ORDER_SHIPPED` -> `Shipped`
- `OUT_FOR_DELIVERY` or equivalent status label -> `Out for delivery`
- `ORDER_DELIVERED` -> `Delivered`
- `ORDER_CANCELLED` -> `Cancelled`

Current-backend alignment detail:

- `validation/schemas.js` already allows `Shipped`, `Out for delivery`, `Delivered`, and `Cancelled`
- `whatsappService.js` currently only has placed/outForDelivery/delivered notification helpers
- so `ORDER_SHIPPED` and `ORDER_CANCELLED` need new WhatsApp support if you want them to notify customers

Use the existing exact local status strings already supported by `orderStatusSchema`.

## 9. `server/routes/orderRoute.js`

Add the new routes here if you want them under `/api/orders`.

Recommended additions:

- `POST /create`
- `POST /:orderId/shiprocket/retry` for admin/manual retry

Because `app.js` mounts `orderRouter` at both `/api/order` and `/api/orders`, adding `/create` here automatically exposes:

- `/api/orders/create`
- `/api/order/create`

If you only want one public path, remove one mount later.

Recommended additions that fit the current backend better than a raw duplicate create endpoint:

- `POST /:orderId/shiprocket/retry`
- `GET /:orderId/shiprocket`
- `GET /:orderId/shiprocket/track`

## 10. `server/routes/webhookRoute.js`

Add:

- `POST /shiprocket`

Important Express detail:

`app.js` mounts `/api/webhooks` before the global `express.json()` middleware. That means the Shiprocket webhook route must attach its own parser.

Recommended route shape:

```js
webhookRouter.post(
  '/shiprocket',
  express.json({ limit: '256kb' }),
  handleShiprocketWebhook
);
```

If you add a signature check based on raw body later, change this to use `verify` and store `req.rawBody`, like the existing WhatsApp webhook implementation.

This is already well aligned with the current app because `app.js` mounts `/api/webhooks` before the global JSON middleware.

## 11. `server/middleware/errorHandler.js`

Keep the centralized error handler and improve it to understand normalized upstream errors.

Recommended pattern:

- Shiprocket service throws errors with `statusCode`
- controller uses `next(error)` where practical
- error middleware converts those into standard API responses

Recommended status handling:

- invalid client payload -> `400`
- not found order -> `404`
- upstream Shiprocket auth or transport failure -> `502`
- unexpected server failure -> `500`

Do not expose raw Shiprocket internals to the frontend.

## 12. `server/controllers/systemController.js` and `server/routes/systemRoute.js`

These files are already present in the repo and are a better home for integration-health metadata than order routes.

Recommended changes:

- include `shiprocketEnabled`
- include `shiprocketConfigured`
- include `shiprocketHealthy` if you later add a lightweight probe

Recommended optional route:

- `GET /api/system/shiprocket/test`

That route can internally call the same `getValidToken()` logic without exposing secrets.

## Suggested Internal Data Flow

## A. COD Flow

1. frontend calls existing COD endpoint
2. local order is created in Mongo
3. `sendOrderPlacedMessage(order)` runs
4. `syncOrderToShiprocket(order)` runs
5. Shiprocket identifiers are saved onto the order
6. response returns local order success

If Shiprocket sync fails:

- order still exists
- admin can retry sync
- logs contain the failure

## B. Stripe/Razorpay Flow

1. payment succeeds
2. local order is created or marked paid
3. Shiprocket sync happens after payment confirmation
4. order is now ready for warehouse/fulfillment

This prevents unpaid orders from being pushed into Shiprocket.

## C. Webhook Flow

1. Shiprocket calls `/api/webhooks/shiprocket`
2. webhook is validated and deduped
3. order is updated with latest shipping status
4. WhatsApp template is sent for the mapped customer event
5. log entry is written

## Webhook Security

The raw brief did not include a Shiprocket webhook verification mechanism, but production code should not leave this endpoint open.

Recommended options, in order:

1. If Shiprocket supports a shared secret header in your account configuration, verify it.
2. If not, include a long random token in the webhook URL and verify it server-side.
3. If possible, also restrict by IP allowlist at the edge or reverse proxy.

Recommended envs:

- `SHIPROCKET_WEBHOOK_SECRET`
- `SHIPROCKET_WEBHOOK_TOKEN`

If neither is available, at minimum:

- validate payload structure strictly
- dedupe events
- ignore events that do not match an existing order
- log suspicious payloads

## Status Mapping Strategy

Shiprocket and Lavish Fashion do not necessarily use the same wording. Normalize external values before updating Mongo.

Recommended mapping function:

- uppercase input
- trim spaces
- map known labels to local status strings

Examples:

- `NEW` -> do not change local customer-facing status
- `SHIPPED` -> `Shipped`
- `OUT FOR DELIVERY` -> `Out for delivery`
- `DELIVERED` -> `Delivered`
- `CANCELLED` or `CANCELED` -> `Cancelled`

Never downgrade a final state:

- once local status is `Delivered`, ignore later webhook noise unless you explicitly support returns/RTO
- once local status is `Cancelled`, ignore non-cancelled updates

## Logging Plan

Use `server/config/logger.js` and child loggers.

Recommended log contexts:

- `integration: 'shiprocket'`
- `action: 'generate_token'`
- `action: 'create_order'`
- `action: 'track_shipment'`
- `action: 'webhook'`

Log these events:

- token refresh success
- token refresh failure
- create-order success
- create-order failure
- webhook accepted
- webhook deduped
- webhook status transition
- tracking sync failure

Never log:

- Shiprocket password
- raw bearer token
- full customer PII when not needed

## Recommended Extra Endpoints Beyond the Raw Brief

These are worth adding even though they were not explicitly requested:

- `POST /api/orders/:orderId/shiprocket/retry`
- `GET /api/orders/:orderId/shiprocket`
- `GET /api/orders/:orderId/shiprocket/track`

Why:

- retries are needed when upstream sync fails
- support needs a quick way to inspect fulfillment state
- admin screens usually need shipment visibility

## Testing Plan

This repo uses Vitest. Add tests under `server/tests/`.

Recommended tests:

### Unit tests

- `shiprocket.config.unit.test.js`
  - returns cached token before refresh threshold
  - refreshes after 23 hours
  - serializes concurrent token refresh requests

- `shiprocket.service.unit.test.js`
  - adds bearer token
  - retries once on `401`
  - normalizes upstream Axios errors
  - maps create-order response correctly
  - reconciles by stable reference order id before retrying create after ambiguous failures

- `whatsapp.service.unit.test.js`
  - add coverage for generic `sendTemplateMessage`
  - confirm ordered parameters are preserved
  - confirm amount parameter works with the template body using `\\u20B9{{3}}`

### Integration tests

- `shiprocket.webhook.integration.test.js`
  - shipped webhook updates order
  - delivered webhook updates order and triggers WhatsApp
  - cancelled webhook updates order
  - duplicate webhook is ignored safely
  - webhook dedupe model prevents reprocessing the same event key

- `order.shiprocket.integration.test.js`
  - COD order is saved even if Shiprocket create fails
  - prepaid order sync waits for payment confirmation
  - local order uses a short Shiprocket-compatible reference id instead of raw Mongo `_id`

## Implementation Order

Follow this sequence to keep the rollout safe:

1. add env validation
2. add Shiprocket config token manager
3. add Shiprocket service with Axios client and retry logic
4. add stable short `shiprocket.referenceOrderId`
5. extend order and payment attempt models with Shiprocket and snapshot fields
6. update checkout normalization to include SKU and customer email sourcing
7. add webhook event dedupe model
8. add webhook schema and controller
9. add webhook route
10. add internal `syncOrderToShiprocket` hook to the order lifecycle
11. add test or system integration-health route
12. add retry endpoint
13. add tests

## Recommended Release Strategy

Roll out in phases.

### Phase 0

- backfill product SKU data
- decide the Shiprocket reference order id format
- enable the feature behind `SHIPROCKET_ENABLED`

### Phase 1

- token manager
- test route
- create-order sync
- no automatic webhook-driven customer messaging yet

### Phase 2

- webhook handling
- status mapping
- WhatsApp shipped/out-for-delivery/delivered/cancelled templates

### Phase 3

- admin retry endpoint
- tracking refresh endpoint
- dashboard visibility

## Final Recommendation

If you implement only one principle from this document, make it this:

Local order persistence must succeed independently from Shiprocket availability, and Shiprocket sync must happen as a resilient post-order fulfillment step.

That one decision is what keeps checkout stable while still giving you automated fulfillment.
