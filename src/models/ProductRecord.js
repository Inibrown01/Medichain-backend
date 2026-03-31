const mongoose = require("mongoose");

const ProductRecordSchema = new mongoose.Schema(
  {
    productId: { type: Number, required: true, unique: true, index: true },
    drugName: { type: String, required: true },
    manufacturer: { type: String, required: true, index: true },
    nafDacNumber: { type: String, required: true, index: true },
    batchNumber: { type: String, required: true, index: true },
    ipfsCid: { type: String, default: "" },
    statusNumber: { type: Number, required: true, default: 0 },
    verificationResult: {
      type: String,
      enum: ["GENUINE", "FLAGGED", "NOT_REGISTERED"],
      default: "NOT_REGISTERED",
      index: true
    },
    duplicateCount: { type: Number, default: 0 },
    chainCreatedAt: { type: Number, default: 0 },
    lastTransactionHash: { type: String, default: "" },
    /** On-chain manufacturer wallet (0x...) when provided at registration */
    manufacturerWallet: { type: String, default: "" }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("ProductRecord", ProductRecordSchema);

