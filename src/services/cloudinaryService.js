/**
 * Public, non-sensitive images (marketing, UI assets, generic product photos without compliance proofs).
 * Configure CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
 */

const cloudinary = require("cloudinary").v2;

let configured = false;

function configure() {
  if (configured) return;
  const { CLOUDINARY_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (CLOUDINARY_URL) {
    cloudinary.config({ secure: true });
  } else if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
      secure: true
    });
  }
  configured = true;
}

function isConfigured() {
  return Boolean(
    process.env.CLOUDINARY_URL ||
      (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
  );
}

/**
 * @param {Buffer} buffer
 * @param {{ folder?: string, publicId?: string }} [opts]
 * @returns {Promise<{ url: string, publicId: string, width?: number, height?: number }>}
 */
function uploadImageBuffer(buffer, opts = {}) {
  configure();
  if (!isConfigured()) {
    throw new Error("Cloudinary is not configured");
  }

  const folder = opts.folder || "medichain/public";

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        ...(opts.publicId ? { public_id: opts.publicId } : {})
      },
      (err, result) => {
        if (err) return reject(err);
        if (!result) return reject(new Error("Empty Cloudinary result"));
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height
        });
      }
    );
    stream.end(buffer);
  });
}

module.exports = {
  isConfigured,
  uploadImageBuffer
};
