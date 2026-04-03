const express = require("express");
const multer = require("multer");
const { requireManufacturerOrAdmin } = require("../middleware/auth");
const ipfsService = require("../services/ipfsService");
const cloudinaryService = require("../services/cloudinaryService");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

/**
 * Sensitive / trust-critical files → IPFS (Pinata). Requires admin or manufacturer JWT.
 * multipart field name: file
 */
router.post("/uploads/ipfs", requireManufacturerOrAdmin, upload.single("file"), async (req, res, next) => {
  try {
    if (!ipfsService.isConfigured()) {
      return res.status(503).json({
        ok: false,
        error: "IPFS_NOT_CONFIGURED",
        message: "Configure PINATA_JWT or PINATA_API_KEY + PINATA_SECRET_KEY"
      });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "Missing file (use multipart field name: file)"
      });
    }

    const { cid, pinSize } = await ipfsService.pinFile(req.file.buffer, req.file.originalname, {
      name: req.file.originalname,
      keyvalues: {
        uploadedBy: req.user?.email || req.user?.sub || "unknown",
        role: req.user?.role || ""
      }
    });

    return res.status(201).json({
      ok: true,
      data: {
        cid,
        ipfsUri: `ipfs://${cid}`,
        gatewayUrl: ipfsService.gatewayUrl(cid),
        size: pinSize
      }
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * Pin JSON metadata to IPFS (e.g. structured submission payload). Admin or manufacturer.
 */
router.post("/uploads/ipfs-json", requireManufacturerOrAdmin, async (req, res, next) => {
  try {
    if (!ipfsService.isConfigured()) {
      return res.status(503).json({
        ok: false,
        error: "IPFS_NOT_CONFIGURED",
        message: "Configure Pinata credentials"
      });
    }
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "JSON body required" });
    }

    const { cid } = await ipfsService.pinJson(body, "submission-metadata.json");
    return res.status(201).json({
      ok: true,
      data: {
        cid,
        ipfsUri: `ipfs://${cid}`,
        gatewayUrl: ipfsService.gatewayUrl(cid)
      }
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * Public images (marketing, generic photos) → Cloudinary. No JWT required; rate-limit in production.
 */
router.post("/uploads/image", upload.single("file"), async (req, res, next) => {
  try {
    if (!cloudinaryService.isConfigured()) {
      return res.status(503).json({
        ok: false,
        error: "CLOUDINARY_NOT_CONFIGURED",
        message: "Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME + API keys"
      });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "Missing image (multipart field name: file)"
      });
    }

    const folder =
      typeof req.query.folder === "string" && req.query.folder.trim()
        ? req.query.folder.trim()
        : "medichain/public";
    const result = await cloudinaryService.uploadImageBuffer(req.file.buffer, { folder });

    return res.status(201).json({
      ok: true,
      data: result
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
