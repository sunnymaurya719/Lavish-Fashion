import validator from "validator";
import bcrypt from "bcrypt"
import userModel from "../models/userModel.js";
import jwt from "jsonwebtoken"

const createToken = (id) =>{
    return jwt.sign({id},process.env.JWT_SECRET, { expiresIn: '7d' })
}

const createAdminToken = (email) => {
    return jwt.sign(
        { role: 'admin', email },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
}


//Route for user login
const loginUser = async (req,res) =>{
    
    try {
        
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        //checking user exist or not
        const user = await userModel.findOne({email});
        if(!user){
            return res.status(404).json({success:false, message:"User doesn't exist"});
        }

        

        //comparing password
        const isPasswordCorrect = await bcrypt.compare(password,user.password);
        if(isPasswordCorrect){
            const token = createToken(user._id);
            res.status(200).json({success:true,token});
        }
        else{
            res.status(401).json({success:false,message:"Invalid credentials"});
        }

    }
    catch(error){
        req.log?.error({ err: error }, 'Error in user login');
        res.status(500).json({success:false,message:'Unable to login'})
    }

}

//Route for user registration
const registerUser = async (req,res) =>{
    try {
        const name = String(req.body.name || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!name || !email || !password) {
            return res.status(400).json({success:false, message:'Name, email and password are required'});
        }

        //checking user already exist or not
        const existingUser = await userModel.findOne({email});
        if(existingUser){
            return res.status(409).json({success:false, message:"User already exists"});
        }

        // validating email format and password
        if(!validator.isEmail(email)) {
            return res.status(400).json({success:false, message:"Invalid email"});
        }
        if(password.length < 8){
            return res.status(400).json({success:false, message:"Please enter a strong password"})
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

        res.status(201).json({success:true,token});

    }
    catch(error){
        req.log?.error({ err: error }, 'Error in user registration');
        res.status(500).json({success:false,message:'Unable to register user'});
    }
    

}

//Route for admin login
const adminLogin = async (req,res) =>{
    try{
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        if(email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD){
            const token  = createAdminToken(email);
            return res.status(200).json({success:true,token});
        }

        return res.status(401).json({success:false,message:"Invalid admin credentials"});
    }
    catch(error){
        req.log?.error({ err: error }, 'Error in admin login');
        res.status(500).json({success:false,message:"Error in admin login"})
    }
}

export {loginUser, registerUser,adminLogin}