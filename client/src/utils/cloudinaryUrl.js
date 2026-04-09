/**
 * Transform a Cloudinary URL to serve optimized images.
 * Adds f_auto (WebP/AVIF), q_auto, and optional width resize.
 *
 * @param {string} url - Original Cloudinary URL
 * @param {object} [opts]
 * @param {number} [opts.width] - Desired display width in px
 * @returns {string} Transformed URL
 */
export function cloudinaryUrl(url, { width } = {}) {
  if (!url || typeof url !== 'string') return url;

  // Only transform Cloudinary URLs
  if (!url.includes('res.cloudinary.com')) return url;

  // Already has transformations — skip
  if (/\/f_auto|\/q_auto/.test(url)) return url;

  const transforms = ['f_auto', 'q_auto'];
  if (width) transforms.push(`w_${width}`, 'c_limit');

  // Insert transforms after /upload/
  return url.replace('/upload/', `/upload/${transforms.join(',')}/`);
}
