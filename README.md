# Lavish Fashion

Lavish Fashion is a full-stack ecommerce project with three separate apps:

- `client` for the customer storefront
- `admin` for product and order management
- `server` for the API, auth, cart, checkout, and payment workflows

The project uses React on the frontend, Express on the backend, MongoDB for persistence, Cloudinary for media uploads, and Stripe/Razorpay for online payments.

## Current Features

### Storefront
- Product listing and single product pages
- Category and subcategory filtering
- Cart management
- User signup and login
- Customer profile page with editable name and phone
- Checkout with Stripe, Razorpay, and Cash on Delivery
- Buy now flow
- Order history page

### Admin
- Admin login
- Add product
- Edit product
- Delete product
- Product list
- Order list with status updates

### Backend
- JWT auth for users and admin
- Request validation with Zod
- Cart APIs
- Product add, update, remove, list, and single-item APIs
- Order creation for Stripe, Razorpay, and Cash on Delivery
- Stripe and Razorpay payment verification
- Stripe and Razorpay webhook handling
- Rate limiting, structured logging, and idempotent checkout requests
- Automated server tests for core auth, cart, order, checkout, and webhook flows

## Tech Stack

### Frontend
- React
- React Router
- Tailwind CSS
- Axios
- Vite

### Backend
- Node.js
- Express
- MongoDB with Mongoose
- JWT
- Zod
- Cloudinary
- Stripe
- Razorpay

## Project Structure

```text
Lavish Fashion/
├── admin/
├── client/
├── server/
├── ADVANCED_ECOMMERCE_LAUNCH_ROADMAP.md
└── README.md
```

## Environment Variables

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

# Realtime (Admin Instant Order Updates)
REALTIME_ENABLED=true
REALTIME_PROVIDER=ably
ABLY_API_KEY=your_ably_api_key
REALTIME_TOKEN_TTL_MS=600000
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

## Local Development

Install dependencies inside each app:

```bash
cd server && npm install
cd client && npm install
cd admin && npm install
```

Run the apps in separate terminals:

```bash
cd server && npm run server
cd client && npm run client
cd admin && npm run admin
```

Default local ports:

- `client`: `5173`
- `admin`: `5174`
- `server`: `4000`

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

## Roadmap

The next major upgrade plan is documented in:

- [ADVANCED_ECOMMERCE_LAUNCH_ROADMAP.md](./ADVANCED_ECOMMERCE_LAUNCH_ROADMAP.md)

That document lists the missing launch-level features for catalog management, customer accounts, promotions, analytics, operations, SEO, and deployment readiness.
