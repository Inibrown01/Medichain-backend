const mongoose = require("mongoose");

const RecallRequestSchema = new mongoose.Schema(
  {
    manufacturerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ManufacturerUser",
      index: true
    },
    manufacturerName: { type: String, default: "" },
    productName: { type: String, required: true },
    /** Comma-separated or single batch id */
    batchNumber: { type: String, required: true },
    batchesLabel: { type: String, default: "" },
    recallDate: { type: Date },
    severity: { type: String, enum: ["low", "medium", "high", ""], default: "" },
    reason: { type: String, default: "" },
    reasonCode: { type: String, default: "" },
    riskAnalysis: { type: String, default: "" },
    detailDescription: { type: String, default: "" },
    requiredActions: { type: String, default: "" },
    source: { type: String, enum: ["manufacturer", "regulatory"], default: "manufacturer" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "completed"],
      default: "pending",
      index: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("RecallRequest", RecallRequestSchema);
