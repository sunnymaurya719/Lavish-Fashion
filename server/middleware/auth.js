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

const authUser = async(req,res,next) =>{
    const token = extractToken(req);

    if(!token){
        return res.status(401).json({success:false , message : 'Not authorized. Please login again.'})
    }

    try{
        const token_decode = jwt.verify(token,process.env.JWT_SECRET);

        if (!token_decode?.id) {
            return res.status(401).json({ success: false, message: 'Invalid token payload' });
        }

        req.userId = token_decode.id;
        req.body.userId = token_decode.id;
        next();
    }
    catch(error){
        req.log?.warn({ err: error }, 'Auth middleware error');
        res.status(401).json({success:false, message :'Invalid or expired token'})
    }
}

export default authUser;