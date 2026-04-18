# Vercel Deployment Guide

This repository is deployed as four separate Vercel projects from the same GitHub repo.

Important:

- deploying `ml-service` to Vercel does not give you the full XGBoost runtime
- the Vercel Python setup here is for body analysis plus heuristic fit recommendations
- if you want `predictionSource: "xgboost_regressor"` with `modelLoaded: true`, deploy `ml-service` on a Docker-capable host instead

## Project Map

| Project | Root Directory | Talks to |
| --- | --- | --- |
| `client` | `client` | `server` |
| `admin` | `admin` | `server` |
| `server` | `server` | MongoDB, payments, Cloudinary, `ml-service` |
| `ml-service` | `ml-service` | no browser app directly |

## Connection Rule

Use this flow:

- `client -> server -> ml-service`
- `admin -> server -> ml-service`

Do not put the `ml-service` URL in `client` or `admin`.

## Why

- the ML shared secret should stay on the server side only
- the browser apps stay simpler because they only know one backend URL
- the main server can fall back when the ML service is unavailable

## Environment Variables

### `ml-service`

```env
ML_APP_ENV=production
MODEL_VERSION=xgb-fit-v1
MODEL_PATH=app/models/size_recommender.joblib
ML_SERVICE_SHARED_SECRET=replace-with-a-long-random-secret
```

### `server`

```env
ML_SERVICE_URL=https://your-ml-service.vercel.app
ML_SERVICE_SHARED_SECRET=replace-with-the-same-secret-used-by-ml-service
ML_SERVICE_TIMEOUT_MS=4000
CRON_SECRET=replace-with-a-long-random-secret
SHIPROCKET_WEBHOOK_API_KEY=replace-with-your-shiprocket-webhook-key
SHIPROCKET_WEBHOOK_DRAIN_BATCH_SIZE=25
SHIPROCKET_WEBHOOK_DRAIN_TIME_BUDGET_MS=15000
SHIPROCKET_WEBHOOK_DRAIN_LOCK_TTL_MS=45000
SHIPROCKET_WEBHOOK_PROCESSING_STALE_AFTER_MS=300000
```

### `client`

```env
VITE_BACKEND_URL=https://your-server.vercel.app
```

### `admin`

```env
VITE_BACKEND_URL=https://your-server.vercel.app
```

## Model Artifact

The trained model file lives at:

- `ml-service/app/models/size_recommender.joblib`

This file must be present in deployment if you want the trained model to load in production.

If the file is missing, the ML service can still start, but it will fall back to heuristic mode.

## FastAPI Entrypoint

The `ml-service` Vercel project uses:

- `ml-service/index.py`

This is the FastAPI entrypoint exported to Vercel.

No custom `functions` mapping is required for this setup.

## Vercel Dependency Limit

Vercel Python serverless functions have a strict dependency size limit.

Because `xgboost` and its native dependencies are too large for this limit, the deployable Vercel runtime uses:

- `ml-service/requirements.txt`

That slim runtime keeps the service deployable for:

- body analysis
- heuristic recommendations

The full local ML stack remains in:

- `ml-service/requirements.local.txt`

That file is for local development and non-Vercel hosting where the trained XGBoost artifact can actually run.

In practice, this means the Vercel `ml-service` health endpoint can be up while `/health` still reports `modelLoaded: false`.

## If You Need Real XGBoost

Deploy only `ml-service` outside Vercel using the included `ml-service/Dockerfile`, then point the Vercel `server` project at that URL with:

```env
ML_SERVICE_URL=https://your-ml-service-host
ML_SERVICE_SHARED_SECRET=replace-with-the-same-secret-used-by-ml-service
ML_SERVICE_TIMEOUT_MS=4000
```

Then verify:

1. `https://your-ml-service-host/health` returns `modelLoaded: true`
2. `server` has the same shared secret
3. storefront products are `fitEnabled` and have enough fit measurements to be marked ready

## Deployment Order

1. Deploy `ml-service`
2. Open `/health` on the deployed `ml-service`
3. Add that URL to `server` as `ML_SERVICE_URL`
4. Deploy `server`
5. Update `client` and `admin` to use the deployed `server` URL
6. Deploy `client`
7. Deploy `admin`

## Shiprocket Drain Cron

The server now includes a cron-safe Shiprocket webhook drain endpoint:

- `GET /api/system/shiprocket/webhook-drain`

This endpoint is intended for Vercel Cron Jobs and expects:

- `Authorization: Bearer <CRON_SECRET>`

There is also an admin-only manual trigger:

- `POST /api/system/shiprocket/webhook-drain`

And an admin-only queue health endpoint:

- `GET /api/system/shiprocket/webhook-status`

The drain job is protected with a distributed MongoDB lock, bounded batch size, a time budget, and stale-processing recovery for events that were left mid-flight by an interrupted serverless run.

Example `server/vercel.json` cron snippet:

```json
{
  "crons": [
    {
      "path": "/api/system/shiprocket/webhook-drain",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Choose the schedule based on how quickly you want unmatched or failed webhook events retried. A shorter interval improves recovery speed, while the endpoint itself keeps each run bounded and overlap-safe.

## Shiprocket Ops Testing

Webhook enqueue test:

```bash
curl -X POST "https://your-server.vercel.app/api/webhooks/shiprocket" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${SHIPROCKET_WEBHOOK_API_KEY}" \
  -d '{
    "event_id": "ship_evt_manual_1",
    "event": "shipment_update",
    "shipment_id": 3201,
    "order_id": 9201,
    "awb_code": "AWB2001",
    "current_status": "Shipped",
    "current_status_id": 17,
    "updated_at": "2026-04-18T10:00:00.000Z"
  }'
```

Cron drain test:

```bash
curl -X GET "https://your-server.vercel.app/api/system/shiprocket/webhook-drain" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "User-Agent: vercel-cron/1.0"
```

Manual admin drain test:

```bash
curl -X POST "https://your-server.vercel.app/api/system/shiprocket/webhook-drain" \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -d '{
    "batchSize": 10,
    "timeBudgetMs": 12000
  }'
```

Queue status check:

```bash
curl -X GET "https://your-server.vercel.app/api/system/shiprocket/webhook-status" \
  -H "Authorization: Bearer ${ADMIN_JWT}"
```

The status endpoint returns:

- pending queued events
- processing event count
- retryable failure counts
- active lock details
- the last drain run timestamp and latest drain summary
