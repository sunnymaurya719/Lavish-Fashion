# Vercel Deployment Guide

This repository is deployed as four separate Vercel projects from the same GitHub repo.

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

## Deployment Order

1. Deploy `ml-service`
2. Open `/health` on the deployed `ml-service`
3. Add that URL to `server` as `ML_SERVICE_URL`
4. Deploy `server`
5. Update `client` and `admin` to use the deployed `server` URL
6. Deploy `client`
7. Deploy `admin`
