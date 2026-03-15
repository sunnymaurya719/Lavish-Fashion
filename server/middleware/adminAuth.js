import jwt from 'jsonwebtoken';

const extractToken = (req) => {
    const headerToken = req.headers.token;
    const authHeader = req.headers.authorization;

    if (headerToken) {
        return headerToken;
    }

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }

    return null;
};

const adminAuth = (req,res,next) =>{
    try{
        const token = extractToken(req);
        if(!token){
            return res.status(401).json({success:false,message:"Not authorized"});
        }
        const token_decode = jwt.verify(token,process.env.JWT_SECRET);
        const isAdminToken = token_decode?.role === 'admin';
        const isExpectedAdmin = token_decode?.email === process.env.ADMIN_EMAIL;

        if(!isAdminToken || !isExpectedAdmin){
            return res.status(403).json({success:false,message:"Not authorized"});
        }

        req.admin = { email: token_decode.email };
        next();
    }
    catch(error){
        req.log?.warn({ err: error }, 'Error in admin auth middleware');
        res.status(401).json({success:false,message:"Invalid or expired admin token"})
    }
}

export default adminAuth;