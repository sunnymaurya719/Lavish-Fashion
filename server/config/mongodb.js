// import mongoose from "mongoose"
 

// const connectDB = async () => {
    
//     try{
//         await mongoose.connect(process.env.MONGODB_URI);
//         console.log("Mongodb connected");
//     }
//     catch(error){
//         console.log("Mongodb connection error",error);
//     }
// }

// export default connectDB;

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable");
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
    }).then((mongoose) => mongoose);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export default connectDB;

