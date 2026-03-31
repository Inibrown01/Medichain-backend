const mongoose = require("mongoose");

const QrGenerationSchema = new mongoose.Schema(
  {
    manufacturerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ManufacturerUser",
      required: true,
      index: true
    },
    level: { type: String, enum: ["product", "batch"], required: true },
    productLabel: { type: String, required: true },
    format: { type: String, default: "png" },
    includeVerificationUrl: { type: Boolean, default: true },
    includeProductMetadata: { type: Boolean, default: true },
    includeBatchIntegrityHash: { type: Boolean, default: true },
    previewDataUrl: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("QrGeneration", QrGenerationSchema);
