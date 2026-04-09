import { v2 as cloudinary } from 'cloudinary';
import { unlink } from 'fs/promises';

const isCloudinaryConfigured = () =>
    Boolean(process.env.CLOUDINARY_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_SECRET_KEY);

const safeUnlink = async (path) => {
    if (!path) {
        return;
    }

    try {
        await unlink(path);
    } catch {
        // Ignore temp file cleanup issues after upload attempts.
    }
};

const uploadReviewMediaFiles = async (files = []) => {
    const normalizedFiles = Array.isArray(files) ? files.filter(Boolean) : [];

    if (normalizedFiles.length === 0) {
        return [];
    }

    if (!isCloudinaryConfigured()) {
        throw new Error('Review media uploads are not configured on the server');
    }

    const uploadedMedia = [];

    for (const file of normalizedFiles) {
        try {
            const result = await cloudinary.uploader.upload(file.path, {
                folder: 'lavish-fashion/reviews',
                resource_type: 'image',
                transformation: [{ quality: 'auto', fetch_format: 'auto' }]
            });

            uploadedMedia.push({
                url: result.secure_url,
                assetId: result.public_id || ''
            });
        } finally {
            await safeUnlink(file.path);
        }
    }

    return uploadedMedia;
};

export { uploadReviewMediaFiles };
