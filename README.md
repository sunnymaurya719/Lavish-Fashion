# Lavish Fashion

Lavish Fashion is a full-stack ecommerce project split into four apps inside one repository:

- `client` for the customer storefront
- `admin` for the admin workspace
- `server` for the main API, auth, cart, checkout, orders, and payments
- `ml-service` for fit recommendations and camera-based body analysis

## Project Structure

```text
Lavish Fashion/
|-- admin/
|-- client/
|-- ml-service/
|-- server/
`-- README.md
```

## Architecture

Use this connection flow:

- `client -> server`
- `admin -> server`
- `server -> ml-service`

Important:

- `client` and `admin` should not call `ml-service` directly
- the ML shared secret belongs only in `server` and `ml-service`
- if `ml-service` is unavailable, `server` can still fall back to the rule engine for size recommendations

## Local Environment Variables

### Server

Create `server/.env` with values like:

```env
PORT=4000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret

ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_admin_password

CLOUDINARY_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_SECRET_KEY=your_cloudinary_secret

CLIENT_URL=http://localhost:5173
ADMIN_URL=http://localhost:5174
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173,http://localhost:5174

STRIPE_SECRET_KEY=your_stripe_secret
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret

REALTIME_ENABLED=true
REALTIME_PROVIDER=ably
ABLY_API_KEY=your_ably_api_key
REALTIME_TOKEN_TTL_MS=600000

ML_SERVICE_URL=http://127.0.0.1:8011
ML_SERVICE_SHARED_SECRET=replace-with-long-random-secret
ML_SERVICE_TIMEOUT_MS=4000
```

### Client

Create `client/.env` with:

```env
VITE_BACKEND_URL=http://localhost:4000
VITE_RAZORPAY_KEY_ID=your_razorpay_public_key
```

### Admin

Create `admin/.env` with:

```env
VITE_BACKEND_URL=http://localhost:4000
VITE_REALTIME_ENABLED=true
```

### ML Service

Create `ml-service/.env` with:

```env
ML_APP_ENV=development
MODEL_VERSION=xgb-fit-v1
MODEL_PATH=app/models/size_recommender.joblib
ML_SERVICE_SHARED_SECRET=replace-with-the-same-secret-used-by-server
```

## Local Development

Install dependencies:

```bash
cd server && npm install
cd client && npm install
cd admin && npm install
cd ml-service && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
```

Run the apps in separate terminals:

```bash
cd server && npm run server
cd client && npm run client
cd admin && npm run admin
cd ml-service && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8011
```

Default local ports:

- `client`: `5173`
- `admin`: `5174`
- `server`: `4000`
- `ml-service`: `8011`

## Vercel Deployment

This repository is intended to be deployed as four separate Vercel projects from the same GitHub repo.

Create one Vercel project for each folder and set its Root Directory:

- `client` project -> `client`
- `admin` project -> `admin`
- `server` project -> `server`
- `ml-service` project -> `ml-service`

Recommended deployment order:

1. Deploy `ml-service`
2. Copy the deployed `ml-service` URL into the `server` environment as `ML_SERVICE_URL`
3. Deploy `server`
4. Set `client` and `admin` `VITE_BACKEND_URL` to the deployed `server` URL
5. Deploy `client`
6. Deploy `admin`

Notes:

- `ml-service/index.py` is the Vercel Python entrypoint
- `ml-service/.python-version` pins Python `3.12`
- `ml-service/app/models/size_recommender.joblib` is intentionally allowed in git so the trained model can be deployed with the service

## Useful Commands

### Server

```bash
npm run server
npm run test
npm run build
```

### Client

```bash
npm run client
npm run build
```

### Admin

```bash
npm run admin
npm run build
```

### ML Service

```bash
.venv\Scripts\python.exe -m unittest discover -s tests -v
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8011
```
