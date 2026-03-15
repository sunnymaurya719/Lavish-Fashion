import express from 'express';
import cors from 'cors';
import 'dotenv/config'
import connectDB from './config/mongodb.js';
import connectCloudinary from './config/cloudinary.js';
import userRouter from './routes/userRoute.js';
import productRouter from './routes/productRoute.js';
import cartRouter from './routes/cartRoute.js';
import orderRouter from './routes/orderRoute.js';
//App config

const app = express();
const port = process.env.PORT || 4000;

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/$/, '');

const envOrigins = [
    process.env.CLIENT_URL,
    process.env.ADMIN_URL,
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [])
];

const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    ...envOrigins
]
    .map(normalizeOrigin)
    .filter(Boolean);

const allowedOriginSet = new Set(allowedOrigins);

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOriginSet.has(normalizeOrigin(origin))) {
            return callback(null, true);
        }

        return callback(null, false);
    }
};

//DB config
await connectDB();

//Cloudinary config
await connectCloudinary();


//Middlewares
app.use(express.json());
app.use(cors(corsOptions));


//app endpoints

app.use('/api/user',userRouter);
app.use('/api/product',productRouter);
app.use('/api/cart',cartRouter);
app.use('/api/order',orderRouter);

app.get('/',(req,res) => {
    res.send("API working");
})

app.listen(port, () => console.log(`Listening on localhost:${port}`));