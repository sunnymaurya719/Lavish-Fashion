import jwt from 'jsonwebtoken';

const adminAuth = (req,res,next) =>{
    try{
        const {token} = req.headers;
        if(!token){
            return res.json({success:false,message:"Not authorized"});
        }
        const token_decode = jwt.verify(token,process.env.JWT_SECRET);
        const isAdminToken = token_decode?.role === 'admin';
        const isExpectedAdmin = token_decode?.email === process.env.ADMIN_EMAIL;

        if(!isAdminToken || !isExpectedAdmin){
            return res.json({success:false,message:"Not authorized"});
        }
        next();
    }
    catch(error){
        console.log("Error in admin auth middleware : ",error);
        res.json({success:false,message:"Error in admin auth middleware"})
    }
}

export default adminAuth;