# 🛍️ Lavish Fashion – Full Stack E-Commerce Platform

Lavish Fashion is a modern and scalable **full-stack e-commerce web application** built using **React**, **Node.js**, **Express**, and **MongoDB**.  
It delivers a complete online shopping experience with authentication, admin management, cloud-based image uploads, and secure online payments.

---

## 🌐 Live Demo

- 🔗 **User Website**: https://lavishfashion.vercel.app  
- 🛠 **Admin Panel**: Available with role-based access

---

## ✨ Features

### 👤 User Features
- 🔐 User Authentication & Authorization (JWT)
- 🛍️ Browse products by category
- 🛒 Add to Cart & manage quantities
- ❤️ Wishlist functionality
- 💳 Secure payments using Razorpay
- 📦 Place & track orders
- 📱 Fully responsive UI

### 🛠 Admin Features
- 📊 Admin Dashboard
- ➕ Add / Update / Delete products
- 🖼 Upload product images via Cloudinary
- 📦 Manage orders & users
- 🔒 Protected admin routes

---

## 🛠 Tech Stack

### Frontend
- React.js
- Redux Toolkit
- React Router DOM
- Tailwind CSS
- Vite

### Backend
- Node.js
- Express.js
- MongoDB & Mongoose
- JWT Authentication
- Cloudinary (Image Storage)
- Razorpay (Payment Gateway)

### Deployment
- Frontend: Vercel
- Backend: Vercel
- Database: MongoDB Atlas

---

## 🚀 Getting Started

### 🔧 Prerequisites
- Node.js (v16+)
- npm or yarn
- MongoDB Atlas account
- Cloudinary account
- Razorpay account

---

## 📥 Installation

### 1️⃣ Clone the repository
```bash
git clone https://github.com/sunnymaurya719/Lavish-Fashion.git
cd Lavish-Fashion
 ```

2️⃣ **Install dependencies:**

   ```bash
   npm install
   # or
   yarn install
   ```

3️⃣ **Environment Variables:**

Create a .env file inside the server folder:
   ```bash
   PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
   ```

4️⃣ **Run the application:**
```bash
For server : 
   npm run server
and
For client :
   npm run client
   ```

## 🗂️ Project Structure

```bash
Lavish-Fashion/
│
├── client/                       # React frontend (User Panel)
│   ├── components/               # Reusable UI components
│   ├── pages/                    # Pages (Home, Cart, Login, Orders, etc.)
│   ├── context/                  # Context API (Global state)
│   └── main.jsx
│
├── admin/                        # React Admin Panel
│   ├── components/               # Admin UI components
│   ├── pages/                    # Admin pages (Dashboard, Products, Orders)
│   └── main.jsx
│
├── server/                       # Node.js backend
│   ├── controllers/              # Business logic
│   ├── models/                   # MongoDB schemas
│   ├── routes/                   # API routes
│   ├── middleware/               # Auth, admin & error handling
│   └── index.js
│
└── README.md
```
## 📦 Development Notes

⚡ Built with Vite for fast development

🔐 Secure REST APIs with JWT authentication

🧠 Global state managed using React Context API

👨‍💼 Separate Admin Panel with protected routes

☁️ Cloudinary for image uploads

💳 Razorpay integration for payments

🧩 Clean, scalable folder structure
