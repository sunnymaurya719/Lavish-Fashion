import mongoose from 'mongoose';
import logger from './logger.js';

const connectDB = async() =>{
    try{
        mongoose.connection.on('connected',() => logger.info('Database connected successfully'));
        await mongoose.connect(`${process.env.MONGODB_URI}/LavishFashion`)
    }
    catch(error){
        logger.error({ err: error }, 'MongoDB connection error');
    }
}


export default connectDB;

