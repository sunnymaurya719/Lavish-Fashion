# Refund System Implementation Plan

> Production-grade refund subsystem for Lavish-Fashion (Node.js + ESM + Express + Mongoose + Razorpay).
> Refactor-in-place. Money is integer **paise** in all new code. State changes go through a strict state machine. Every Razorpay call is idempotent. The new `Refund` collection is the single source of truth; `order.refunds[]` becomes a denormalized read cache written by exactly one projector.

---

## 0. Reality Check vs. Original Prompt

| Original prompt assumption | Repo actually has | Decision |
|---|---|---|
| TypeScript strict | ESM JavaScript | **JS ESM** with JSDoc `@typedef` blocks for IDE help |
| Jest + mongodb-memory-server | **Vitest** is already wired | Use Vitest (consistent with `server/tests/*`) |
| BullMQ + Redis | `REDIS_URL` env exists, no Redis client wired, no BullMQ installed | Phase 5 = **node-cron + `distributedLockService` + `systemJobStateService`** (existing pattern). BullMQ deferred. |
| Admin model with `role` field | `adminAuth` is JWT-only, no admin DB, no roles | Add env-driven role resolver: `ADMIN_ROLES_JSON='{"alice@x.com":"manager"}'` → `req.admin.role`. Default role = `support_agent`. |
| New idempotency middleware | `services/idempotencyService.js` already implements `beginIdempotentRequest` / `completeIdempotentRequest` with payload hashing + replay/conflict/in-progress | **Reuse it** via a thin `withRefundIdempotency` adapter. Do not build a parallel store. |
| New webhook handler | `handleRazorpayWebhook` already does signature verify + `razorpayWebhookEventModel` dedup + 200 ack + dispatch | **Refactor in place** — replace `handleRazorpayRefundEvent` body, keep the surrounding pipeline. |
| `order.refunds[]` subdocs | Already exist; values in **rupees** | New `Refund` collection in **paise** is the source of truth. `order.refunds[]` becomes a read-only projection written only by `refundProjector`. |
| Order amount in paise | Order `amount` is in **rupees** | Add `amountInPaise`, `refundedAmountInPaise`, `refundableAmountInPaise` to Order. Backfill via script. Never mutate `amount` (legacy). |
| Wallet balance field | None. Loyalty exists but is separate. | Add `user.walletBalanceInPaise` and treat COD refunds as `WalletCreditStrategy` (atomic `$inc`). |
| MongoDB transactions guaranteed | `connectDB` does not assert replica set | Use `session.withTransaction` when topology supports it; fall back to **atomic `$inc` + compensating rollback** otherwise. |

### Why no transaction is required for the race fix
A single `Order.findOneAndUpdate({ _id, refundableAmountInPaise: { $gte: amount } }, { $inc: { refundableAmountInPaise: -amount } })` is **atomic at the document level** in MongoDB. Two concurrent ₹600 refunds on a ₹1000 order — exactly one matches, the other returns `null` → `InsufficientRefundableAmountError`. Transactions are only used to wrap the *subsequent* multi-document writes (Refund + LedgerEntry); on standalone Mongo we use compensating writes instead.

---

## 1. Architecture

```
┌─────────────────────┐    ┌────────────────────────┐    ┌────────────────────┐
│ Admin UI            │───▶│ refundController       │───▶│ refundService      │
│ (Orders.jsx)        │    │ (HTTP boundary)        │    │ (orchestrator)     │
└─────────────────────┘    └────────────────────────┘    └─────────┬──────────┘
                                  ▲                                │
                                  │ withRefundIdempotency          ├──▶ paise.util
┌─────────────────────┐           │ refundPermissions              ├──▶ refundStateMachine
│ Razorpay Webhook    │───┐       │                                ├──▶ refundRouterService ─┐
└─────────────────────┘   │       │                                │                         │
                          ▼       │                                │                         ▼
┌──────────────────────────────────┐                               │           ┌─────────────────────────┐
│ handleRazorpayWebhook            │──▶ razorpayRefundWebhook  ────┘           │ razorpayRefundStrategy  │
│ (signature, dedup, 200 ack)      │   (calls refundService.processWebhook)    │ walletCreditStrategy    │
└──────────────────────────────────┘                                           └─────────────────────────┘
                                                                                          │
                                                                                          ▼
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────────────┐
│ Refund (truth)  │◀──▶│ refundProjector  │───▶│ Order            │    │ Razorpay API (refund + fetch)│
│  paise          │    │ (single writer)  │    │ refunds[] cache  │    └──────────────────────────────┘
└─────────────────┘    └──────────────────┘    │ refundedAmount…  │
        ▲                                       └──────────────────┘
        │
        │ append-only
        ▼
┌─────────────────┐
│ LedgerEntry     │
└─────────────────┘

Background workers (node-cron, distributed-lock-guarded):
  refundRetryJob          – retries failed refunds w/ exponential backoff
  refundReconciliationJob – syncs DB to Razorpay (Razorpay = truth) for stuck refunds
  razorpayBalanceMonitor  – alerts when balance < threshold or < pending refund total
```

---

## 2. Data Model Changes

### 2a. New collection `refunds` — `server/models/refundModel.js`

| Field | Type | Notes |
|---|---|---|
| `orderId` | ObjectId, indexed, ref `order` | required |
| `paymentId` | String, indexed | Razorpay `pay_…` |
| `gatewayRefundId` | String, sparse-unique | `rfnd_…` (set after gateway accept) |
| `amountInPaise` | Number | `Number.isInteger`, `> 0` |
| `currency` | String | default `'INR'` |
| `state` | Enum `RefundState` | default `'initiated'` |
| `channel` | Enum `RefundChannel` | `'razorpay' \| 'wallet' \| 'bank_transfer'` |
| `reason` | Enum `RefundReason` | |
| `initiatedByAdminId` | String (admin email for now) | required |
| `approvedByAdminId` | String | required when amount > ₹5,000 |
| `retryCount` | Number | default 0 |
| `maxRetries` | Number | default 3 |
| `nextRetryAt` | Date | nullable |
| `idempotencyKey` | String, **unique** | required |
| `refundInitiatedAt` | Date | |
| `refundProcessedAt` | Date | nullable |
| `failureReason` | String | nullable |
| `notes` | String | nullable |
| `metadata` | Mixed | gateway raw response snapshot |
| timestamps | true | |

Indexes: `{ orderId: 1, state: 1 }`, `{ state: 1, nextRetryAt: 1 }` (retry job), unique `idempotencyKey`, sparse-unique `gatewayRefundId`.

### 2b. New collection `ledger_entries` — `server/models/ledgerEntryModel.js`

Append-only. Pre-`save`/`pre-updateOne`/`pre-findOneAndUpdate` hooks throw `LedgerImmutabilityError` if `isNew === false`.

| Field | Type | Notes |
|---|---|---|
| `type` | Enum `'payment' \| 'refund' \| 'wallet_credit'` | |
| `amountInPaise` | Number, integer | **signed** (positive credit, negative debit) |
| `currency` | String | default `'INR'` |
| `referenceId` | String | Razorpay payment/refund id or synthetic |
| `orderId` | ObjectId | indexed |
| `refundId` | ObjectId, ref `refund` | nullable |
| `source` | String | `'razorpay' \| 'wallet' \| 'cod'` |
| `description` | String | |
| `createdAt` | Date, default now | **no `updatedAt`** |

Indexes: `{ orderId: 1, createdAt: -1 }`, `{ referenceId: 1 }`.

### 2c. Order extension — `server/models/orderModel.js`

Additive only (do not delete existing fields):

```js
amountInPaise:           { type: Number, default: 0, min: 0, validate: Number.isInteger }
refundedAmountInPaise:   { type: Number, default: 0, min: 0, validate: Number.isInteger }
refundableAmountInPaise: { type: Number, default: 0, min: 0, validate: Number.isInteger } // set on capture = amountInPaise
// per-item:
items[].pricePaise:           Number, integer
items[].refundedAmountPaise:  Number, default 0
items[].refundStatus:         enum ['none','partial','full'], default 'none'
```

Existing `refundStatus` stays but new code only writes `none|partial|full` (the `pending`/`failed` strings keep working but are no longer authoritative — `Refund` doc state is). Existing `refunds[]` schema stays; only `refundProjector` writes to it.

### 2d. User extension — `server/models/userModel.js`

```js
walletBalanceInPaise:  { type: Number, default: 0, min: 0, validate: Number.isInteger }
walletReservedPaise:   { type: Number, default: 0, min: 0, validate: Number.isInteger }
```

### 2e. Backfill — `server/scripts/backfillRefundPaiseFields.js`

Idempotent script (manual run during deploy):
- For every order: `amountInPaise = round(amount * 100)`, `refundedAmountInPaise = round(refundedAmount * 100)`, `refundableAmountInPaise = max(0, amountInPaise - refundedAmountInPaise)`. For each `items[]`: `pricePaise = round(price * 100)`, `refundedAmountPaise = 0`, `refundStatus = 'none'`.
- Skips orders where `amountInPaise > 0` (already migrated).
- Writes a summary report to stdout (count migrated / skipped / failed).

Existing `order.refunds[]` rows are not mirrored into the new `refunds` collection. They remain visible via the existing UI; new operations create new `Refund` docs. (If full migration is wanted, a follow-up `importLegacyRefunds.js` will be added — flagged but out of scope for v1.)

---

## 3. Module Inventory (all `server/`, ESM, JSDoc-typed)

### 3.1 Utilities

| File | Exports | Responsibility |
|---|---|---|
| `utils/paise.util.js` | `rupeeToPaise`, `paiseToRupees`, `assertPaise`, `safePaiseAdd`, `safePaiseSub`, `paiseFromOrderRupees` | All money math; throws on float / negative / non-integer / unsafe-int. **No floats anywhere else.** |
| `utils/refundStateMachine.js` | `RefundState`, `canTransition`, `transition`, `shouldUpdateFromWebhook`, `statePriority` | Pure functions, no IO. |
| `utils/refundErrors.js` | `RefundError`, `InsufficientRefundableAmountError`, `InvalidRefundTransitionError`, `GatewayError(retryable)`, `RefundPermissionError`, `WalletInsufficientBalanceError`, `LedgerImmutabilityError` | Typed hierarchy with `statusCode` and `retryable` where relevant. |
| `utils/structuredLogger.js` | `refundLogger`, `withRefundContext(log, ctx)` | Thin wrapper over existing `config/logger.js` (pino) — enforces `event` field + `LogContext` shape. |

### 3.2 State machine details

```
Valid transitions:
  initiated  → pending
  initiated  → failed
  pending    → processed
  pending    → failed
  failed     → pending          (retry path)
  permanently_failed            (terminal)

statePriority (for out-of-order webhooks):
  permanently_failed = 0
  failed             = 1
  initiated          = 2
  pending            = 3
  processed          = 4

shouldUpdateFromWebhook(current, incoming) =
  statePriority[incoming] > statePriority[current]
```

### 3.3 Services

| File | Responsibility |
|---|---|
| `services/ledgerService.js` | `recordPayment`, `recordRefund`, `recordWalletCredit`, `getOrderLedger`, `getBalance`, `exportForAccounting(start,end)` — accepts optional Mongo `session`. |
| `services/refundStrategies/razorpayRefundStrategy.js` | Calls `razorpayService.createRefund({ paymentId, amountInRupees: paise/100, idempotencyKey, notes, speed, receipt: idempotencyKey.slice(0,40) })`. Maps SDK errors → `GatewayError({ retryable })`. Network/5xx = retryable, validation/payment-not-found = non-retryable. |
| `services/refundStrategies/walletCreditStrategy.js` | Atomic `User.findOneAndUpdate({ _id }, { $inc: { walletBalanceInPaise: amount }})`. Returns synthetic `gatewayRefundId = 'wallet_<refundId>'`. Always non-retryable failure. |
| `services/refundRouterService.js` | `chooseStrategy(order)` — `Razorpay → razorpayRefundStrategy`, `COD → walletCreditStrategy`. Throws `RefundError` for unknown methods. |
| `services/refundProjector.js` | **Single writer** for `order.refunds[]`, `order.refundedAmountInPaise`, `order.refundStatus`, per-item `refundedAmountPaise/refundStatus`. Idempotent — recomputes from `Refund` collection rather than incrementing. Called from initiate, retry, and webhook paths. Publishes admin realtime upsert. |
| `services/refundService.js` | The orchestrator (see §4). |

### 3.4 Middleware

| File | Responsibility |
|---|---|
| `middleware/refundIdempotency.js` | Reads `Idempotency-Key` header → calls existing `beginIdempotentRequest({ scope: 'order:refund', userId: adminEmail, key, payload })`. On `replay/conflict/in_progress` short-circuits with cached response. Attaches `req.idempotency = { key, recordId, complete(statusCode, body) }` for the controller to call on success/error. |
| `middleware/refundPermissions.js` | Reads `req.admin.role` (default `support_agent`). Enforces `REFUND_LIMITS_PAISE` cap. If `amountInPaise > 500_000` (₹5,000): require `body.approvedByAdminId`, must differ from initiator, must resolve to `manager`+. Logs every check. |

```
REFUND_LIMITS_PAISE = {
  support_agent:  50_000,    // ₹500
  senior_agent:   500_000,   // ₹5,000
  manager:        2_000_000, // ₹20,000
  super_admin:    Number.POSITIVE_INFINITY,
}
```

### 3.5 HTTP & Webhook

| File | Responsibility |
|---|---|
| `controllers/refundController.js` | `initiateRefund(req,res)`, `getRefund`, `listOrderRefunds`, `getOrderLedger`. Thin: validate → call service → call `req.idempotency.complete()` → respond. |
| `routes/refundRoute.js` | `POST /api/refund` (initiate), `GET /api/refund/:id`, `GET /api/refund/order/:orderId`, `GET /api/refund/order/:orderId/ledger`. All `adminAuth` + `refundPermissions` (initiate only) + `withRefundIdempotency` (initiate only). |
| `webhooks/razorpayRefundWebhook.js` | Exports `handleRazorpayRefundEvent({ event, refundEntity, log })` — replaces existing function. Calls `refundService.processWebhookUpdate(...)`. |

### 3.6 Cutover strategy for the existing endpoint

`POST /api/order/:orderId/refund` currently calls `refundOrder` in `orderController.js`. Plan:

1. Phase 4: mount the new route under `/api/refund` AND make `refundOrder` a deprecation shim that translates the legacy body (`{ amount, reason, speed }` in rupees) → new DTO and calls `refundService.initiateRefund`. Behaviour preserved for the admin UI.
2. Phase 6: switch `admin/src/pages/Orders.jsx` to call `/api/refund` directly. Remove the shim in the next release.

### 3.7 Jobs (`server/jobs/` — new)

| File | Schedule | Responsibility |
|---|---|---|
| `jobs/refundRetryJob.js` | Every 10 min | `find({ state: 'failed', retryCount: { $lt: maxRetries }, nextRetryAt: { $lte: now } }).limit(50)` → `Promise.allSettled(refundService.retry(id))`. Backoff: `nextRetryAt = now + 10min * 2^retryCount`. On `retryCount === maxRetries` after this attempt → `permanently_failed` + critical log + admin alert. |
| `jobs/refundReconciliationJob.js` | Daily 02:00 IST | `find({ state: { $in: ['initiated','pending'] }, refundInitiatedAt: { $lt: now-2h }, gatewayRefundId: { $exists: true, $ne: '' } })` → `razorpayService.fetchRefund` → if gateway state ≠ DB state, validate via state machine and apply. WARN-log every discrepancy. Also recomputes per-item totals. |
| `jobs/razorpayBalanceMonitorJob.js` | Daily 09:00 IST | `razorpay.balance.fetch()` (added to `razorpayService` as `fetchBalance()`). If `balance < LOW_BALANCE_THRESHOLD_PAISE` (default `1_000_000`) → CRITICAL log + alert. Also: sum `Refund.amountInPaise` where `state in [initiated,pending]`; if sum > balance → CRITICAL alert. |

All jobs:
- Wrapped in `acquireDistributedLock({ key: 'job:<name>', ttlMs: ... })` for multi-instance safety.
- Tracked via `systemJobStateService.markSystemJobStarted/Finished`.
- Registered in `server.js` using `node-cron` (already a dependency? — verify; if not add). Disabled when `NODE_ENV === 'test'`.

---

## 4. `refundService.js` — Detailed Pseudocode

### 4.1 `initiateRefund(dto)`

```
dto = { orderId, amountInPaise, reason, initiatedByAdminId, approvedByAdminId?, idempotencyKey, notes?, speed='normal' }

1. assertPaise(dto.amountInPaise, 'amountInPaise')

2. Atomic refundability lock (NO transaction needed for this):
   const lockedOrder = await Order.findOneAndUpdate(
     {
       _id: dto.orderId,
       paymentMethod: { $in: ['Razorpay', 'COD'] },
       payment: true,
       refundableAmountInPaise: { $gte: dto.amountInPaise },
       status: { $nin: ['Cancelled refund-blocked'] }   // optional eligibility guard
     },
     { $inc: { refundableAmountInPaise: -dto.amountInPaise } },
     { new: true }
   )
   if (!lockedOrder) throw new InsufficientRefundableAmountError(...)

3. Open optional transaction (if replica set):
   session = await mongoose.startSession()
   await session.withTransaction(async () => {
     a. const refund = await Refund.create([{
          orderId, paymentId: order.razorpayPaymentId || '',
          amountInPaise, currency: 'INR',
          state: 'initiated',
          channel: chooseChannel(order),
          reason, initiatedByAdminId, approvedByAdminId,
          idempotencyKey,
          refundInitiatedAt: new Date(),
          notes
        }], { session })

     b. await ledgerService.recordRefund({
          orderId, refundId: refund._id,
          amountInPaise: -amountInPaise,
          referenceId: idempotencyKey,    // updated to gatewayRefundId after success
          source: 'razorpay'|'wallet'
        }, { session })
   })
   (Standalone fallback: do (a) and (b) sequentially without session.)

4. Run strategy OUTSIDE the transaction (network call):
   try {
     const { gatewayRefundId, channel, raw } = await refundRouterService
        .chooseStrategy(order)
        .execute({ refund, order, idempotencyKey, log })

     refund.gatewayRefundId = gatewayRefundId
     refund.channel         = channel
     refund.metadata        = raw
     refund.state           = stateMachine.transition(refund.state, 'pending')
     await refund.save()

     await refundProjector.project({ orderId })
   } catch (err) {
     // Compensating rollback
     await Order.findByIdAndUpdate(orderId, { $inc: { refundableAmountInPaise: dto.amountInPaise }})
     await Refund.findByIdAndUpdate(refund._id, {
        state: stateMachine.transition('initiated', 'failed'),
        failureReason: err.message,
        nextRetryAt: err.retryable ? new Date(Date.now() + 10*60*1000) : null,
     })
     // Mark ledger entry as voided by appending a compensating credit (append-only)
     await ledgerService.recordRefund({ ... amountInPaise: +amountInPaise, description: 'compensation: gateway failure' })
     refundLogger.error({ event: 'refund_initiate_strategy_failed', err })
     throw err  // bubble to controller for HTTP response
   }

5. Notify customer (fire-and-forget):
   runBackgroundTask(() => notifyRefundInitiated(order, refund), { taskName: 'notifyRefundInitiated' })

6. Return { refund, order: refreshed }
```

### 4.2 `processWebhookUpdate({ event, refundEntity, log })`

```
1. Find refund by gatewayRefundId; if not found, find by paymentId+amountInPaise as fallback (warn).
2. const incoming = mapRazorpayStatus(refundEntity.status)        // processed|failed|pending
3. if (!stateMachine.shouldUpdateFromWebhook(refund.state, incoming)) {
     log.info({ event: 'refund_state_downgrade_blocked', current: refund.state, incoming })
     return refund   // no-op (idempotent)
   }
4. const next = stateMachine.transition(refund.state, incoming)
   refund.state = next
   if (incoming === 'processed') refund.refundProcessedAt = new Date(refundEntity.created_at*1000)
   if (incoming === 'failed') {
      refund.failureReason = refundEntity.error_description || ''
      if (refund.retryCount < refund.maxRetries) {
         refund.nextRetryAt = new Date(Date.now() + 10*60*1000 * Math.pow(2, refund.retryCount))
      } else {
         refund.state = stateMachine.transition(next, 'permanently_failed')
      }
   }
   refund.metadata = refundEntity
   await refund.save()
5. await refundProjector.project({ orderId: refund.orderId })
6. fire-and-forget notify customer
```

### 4.3 `retry(refundId)` — used by `refundRetryJob`

```
1. Load refund. Guard: state === 'failed', retryCount < maxRetries, nextRetryAt <= now.
2. transition failed → pending (state machine). Persist.
3. Run strategy with the SAME idempotencyKey (Razorpay dedups via receipt + our notes.idempotency_key).
4. On success: store gatewayRefundId, projector.
5. On failure: $inc retryCount; if retryCount >= maxRetries → permanently_failed + alert; else set next backoff.
```

---

## 5. Failure Mode Matrix

| Scenario | Detection | Response |
|---|---|---|
| Two concurrent admin refunds same order | Atomic `$inc` filter `$gte: amount` | One succeeds, other → 409 `InsufficientRefundableAmountError` |
| Same idempotency key replayed | `idempotencyService` payload-hash match | Returns cached response, no new Refund doc, no Razorpay call |
| Same key, different payload | `idempotencyService` mismatch | 409 conflict |
| Razorpay 5xx during initiate | `GatewayError(retryable=true)` | Refund → `failed`, `nextRetryAt = now+10m`, lock rolled back, compensating ledger entry. Retry job picks it up. |
| Razorpay 4xx (bad payment id) | `GatewayError(retryable=false)` | Refund → `failed`, no retry scheduled, alert admin. |
| Webhook arrives out of order (`processed` then `failed`) | `shouldUpdateFromWebhook` priority guard | `failed` ignored; state stays `processed`. WARN logged. |
| Duplicate webhook | `razorpayWebhookEventModel` unique `eventId` (existing) + state machine no-op | 200 `{ duplicate: true }`. |
| Bad webhook signature | HMAC verify (existing) | 400. No DB write. |
| Refund stuck in `pending` for > 2h | Reconciliation job + `razorpay.refunds.fetch` | DB state synced to gateway truth. |
| Wallet credit fails after lock | Strategy throws, compensating rollback | Same path as Razorpay failure. |
| Razorpay balance < pending refunds | Balance monitor job sums `state in [initiated,pending]` | CRITICAL alert. |
| Crash between Refund.create and strategy call | Refund row exists in `initiated` state, lock decremented | Reconciliation job sees `initiated > 2h && no gatewayRefundId` → marks `failed`, releases lock via compensating `$inc`. |
| Order doc deleted mid-flow | Strategy/projector reads return null | Refund stays in current state, ERROR logged, admin alert. |

---

## 6. Test Plan (Vitest, mongodb-memory-server)

| File | Coverage |
|---|---|
| `tests/refund.paise.util.test.js` | Conversion accuracy, float rejection, negative rejection, integer overflow guard. |
| `tests/refund.stateMachine.test.js` | Every legal transition succeeds; every illegal one throws; `shouldUpdateFromWebhook` matrix; `permanently_failed` is terminal. |
| `tests/refund.ledgerService.test.js` | Append-only enforcement (`save` on existing throws); `getBalance` sums signed amounts; `exportForAccounting` ranges. |
| `tests/refund.projector.test.js` | Multiple refund states project to correct `order.refundedAmountInPaise` + `refundStatus` + per-item totals; idempotent (running twice = same result). |
| `tests/refund.service.unit.test.js` | Mocked Razorpay. Includes the **race test**: fire two parallel `initiateRefund({amountInPaise: 60_000})` against an order with `refundableAmountInPaise: 100_000` → exactly one fulfilled, one rejected with `InsufficientRefundableAmountError`. Compensation rollback test. |
| `tests/refund.permissions.test.js` | Limit cap by role; dual-approval requirement above ₹5,000. |
| `tests/refund.idempotency.test.js` | Replay returns cached body; conflict on payload mismatch; in-progress 409. |
| `tests/refund.webhook.test.js` | Out-of-order (`processed` before `failed`), duplicate event, bad signature, unknown refund id. |
| `tests/refund.retryJob.test.js` | Backoff math; `maxRetries` → `permanently_failed`; `Promise.allSettled` isolates failures. |
| `tests/refund.reconciliationJob.test.js` | DB drifts to `failed` after 2h with no gateway response; gateway = `processed` while DB = `pending` → DB syncs. |
| `tests/refund.balanceMonitor.test.js` | Threshold trigger; pending-vs-balance trigger. |

Coverage target: **≥ 90 %** lines for everything in `services/refund*`, `utils/paise.util.js`, `utils/refundStateMachine.js`, `services/ledgerService.js`.

---

## 7. Phased Delivery (will pause after each phase)

### Phase 0 — Plan sign-off (this document)
No code yet.

### Phase 1 — Foundations (no behaviour change)
- `utils/paise.util.js`, `utils/refundStateMachine.js`, `utils/refundErrors.js`, `utils/structuredLogger.js`
- `models/refundModel.js`, `models/ledgerEntryModel.js`
- Order/User schema additive extensions (defaults backfilled lazily)
- `scripts/backfillRefundPaiseFields.js`
- Tests: `paise.util`, `stateMachine`, `ledger immutability`
- **Exit criteria**: `npm test` green; no existing test broken.

### Phase 2 — Services + projector (still not wired into HTTP)
- `services/ledgerService.js`
- `services/refundStrategies/razorpayRefundStrategy.js`, `walletCreditStrategy.js`
- `services/refundRouterService.js`
- `services/refundProjector.js`
- Add `fetchBalance` to `razorpayService.js`
- Unit tests with mocked Razorpay.
- **Exit criteria**: projector idempotent on duplicate runs; strategies map errors correctly.

### Phase 3 — Orchestrator + idempotency adapter + permissions
- `services/refundService.js` (initiate, processWebhookUpdate, retry)
- `middleware/refundIdempotency.js`
- `middleware/refundPermissions.js`
- The race-condition test + full unit suite
- **Exit criteria**: race test consistently passes 100 runs; ≥ 90 % coverage on new files.

### Phase 4 — HTTP + webhook integration (cuts over the live path)
- `controllers/refundController.js`, `routes/refundRoute.js`
- `webhooks/razorpayRefundWebhook.js` replaces `handleRazorpayRefundEvent` in `orderController.js`
- `refundOrder` (legacy controller) becomes a thin shim → `refundService.initiateRefund`
- Webhook & e2e tests
- Run `backfillRefundPaiseFields.js` against staging
- **Exit criteria**: existing admin UI flow unchanged; webhook events update new `Refund` docs; legacy `order.refunds[]` projection matches.

### Phase 5 — Background jobs + observability
- `jobs/refundRetryJob.js`, `jobs/refundReconciliationJob.js`, `jobs/razorpayBalanceMonitorJob.js`
- Register in `server.js` (cron schedule, distributed-lock-guarded, system-job-state tracked)
- Job tests
- Add `node-cron` to `server/package.json` if missing
- **Exit criteria**: jobs run idempotently across multiple instances; logs show distributed-lock acquire/release.

### Phase 6 — Cleanup
- Switch `admin/src/pages/Orders.jsx` to call `POST /api/refund`
- Delete `refundOrder` shim and the inline refund logic in `orderController.js`
- Remove direct writes to `order.refunds[]` outside `refundProjector`
- README section + migration runbook
- **Exit criteria**: only `refundProjector` writes to `order.refunds[]`; old code paths removed.

---

## 8. Open Decisions (to confirm before Phase 1)

1. **Admin roles source** — env-based `ADMIN_ROLES_JSON` vs. introducing an `adminUserModel`. Plan currently assumes env. Confirm.
2. **COD refund destination** — `WalletCreditStrategy` adding `user.walletBalanceInPaise`, vs. manual bank-transfer flow with `state` transitioning only on admin clearing. Plan currently assumes wallet credit.
3. **BullMQ vs node-cron** — plan uses `node-cron` + `distributedLockService` (already in repo). Confirm OK to defer BullMQ.
4. **Cutover style in Phase 4** — shim the legacy endpoint to preserve admin UI behaviour, vs. hard swap. Plan assumes shim.
5. **Backfill script execution** — manual via `npm run backfill:refund-paise`, vs. auto-run on boot if any order has `amountInPaise === 0 && amount > 0`. Plan assumes manual.

---

## 9. Coding Conventions (apply to every file)

1. **Money is always integer paise.** Storage, function args, return values. Never floats. Never `amount + 0.01` style guards.
2. **State changes only via `stateMachine.transition()`.** No direct `refund.state = '...'` assignment outside the state machine.
3. **Multi-doc writes use a Mongoose session** when replica set is available; otherwise compensating writes in code.
4. **Errors are typed.** Always throw a `RefundError` subclass; never bare `Error` from refund modules.
5. **No silent catches.** Every `catch` either logs (structured) and re-throws, or logs and explicitly translates.
6. **Notifications are fire-and-forget** via `runBackgroundTask`. Never `await` them in the critical path.
7. **Razorpay calls always pass an idempotency key** — propagated as `notes.idempotency_key` and `receipt` (since `razorpay-node v2.9.x` ignores per-request headers).
8. **Per-item refund tracking** is updated by `refundProjector` from `Refund` docs — never by ad-hoc code.
9. **Currency is always explicit `'INR'`** — never inferred.
10. **No `console.log`.** Use `structuredLogger` / pino. Every log includes `event`.

---

*End of plan. Ready to implement Phase 1 once §8 decisions are confirmed.*
