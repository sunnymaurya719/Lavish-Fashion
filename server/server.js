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

const allowedOrigins = [
    process.env.CLIENT_URL,
    process.env.ADMIN_URL,
    ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
    'http://localhost:5173',
    'http://localhost:5174'
].filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
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