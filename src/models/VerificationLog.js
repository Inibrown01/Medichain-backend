const mongoose = require("mongoose");

const VerificationLogSchema = new mongoose.Schema(
  {
    queryType: { type: String, enum: ["productId", "batchNumber"], required: true },
    productId: { type: Number, default: null, index: true },
    batchNumber: { type: String, default: "", index: true },
    verificationResult: {
      type: String,
      enum: ["GENUINE", "FLAGGED", "NOT_REGISTERED"],
      required: true,
      index: true
    },
    clientIp: { type: String, default: "" },
    userAgent: { type: String, default: "" }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("VerificationLog", VerificationLogSchema);

