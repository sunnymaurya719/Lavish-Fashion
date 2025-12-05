import validator from "validator";
import bcrypt from "bcrypt"
import userModel from "../models/userModel.js";
import jwt from "jsonwebtoken"

const createToken = (id) =>{
    return jwt.sign({id},process.env.JWT_SECRET)
}


//Route for user login
const loginUser = async (req,res) =>{
    
    try {
        
        const {email,password} = req.body;

        //checking user exist or not
        const user = await userModel.findOne({email});
        if(!user){
            return res.json({success:false, message:"User doesn't exist"});
        }

        

        //comparing password
        const isPasswordCorrect = await bcrypt.compare(password,user.password);
        if(isPasswordCorrect){
            const token = createToken(user._id);
            res.json({success:true,token});
        }
        else{
            res.json({success:false,message:"Invalid credentials"});
        }

    }
    catch(error){
        console.log("Error in user login",error);
        res.json({success:false,message:error.message})
    }

}

//Route for user registration
const registerUser = async (req,res) =>{
    try {
        const {name, email, password} = req.body;

        //checking user already exist or not
        const existingUser = await userModel.findOne({email});
        if(existingUser){
            return res.json({success:false, message:"User already exists"});
        }

        // validating email format and password
        if(!validator.isEmail(email)) {
            return res.json({success:false, message:"Invalid email"});
        }
        if(password.length < 8){
            return res.json({success:false, message:"Please enter a strong password"})
        }

        //hashing user password
        const hashedPassword = await bcrypt.hash(password,10);

        //creating new user
        const newUser = new userModel({
            name,
            email,
            password:hashedPassword
        })

        const user = await newUser.save();
        
        const token = createToken(user._id);

        res.json({success:true,token});

    }
    catch(error){
        console.log("Error in user registration",error);
        res.json({success:false,message:error.message});
    }
    

}

//Route for admin login
const adminLogin = async (req,res) =>{
    try{
        const {email,password} = req.body;
        if(email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD){
            const token  = jwt.sign(email+password,process.env.JWT_SECRET);
            res.json({success:true,token});
        }
    }
    catch(error){
        console.log("Error in admin login : ",error);
        res.json({success:false,message:"Error in admin login"})
    }
}

export {loginUser, registerUser,adminLogin}