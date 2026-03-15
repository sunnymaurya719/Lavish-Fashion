import multer from "multer";

const storage = multer.diskStorage({
    filename:function(req,file,callback){
        const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g,'-')}`;
        callback(null,safeName)
    }
})

const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
];

const fileFilter = (req, file, callback) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
        return callback(new Error('Only image files are allowed'));
    }

    callback(null, true);
}

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});

export default upload;