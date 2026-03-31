const mongoose = require("mongoose");

const RecallRequestSchema = new mongoose.Schema(
  {
    manufacturerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ManufacturerUser",
      required: true,
      index: true
    },
    productName: { type: String, required: true },
    batchNumber: { type: String, required: true },
    recallDate: { type: Date },
    severity: { type: String, default: "" },
    reason: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("RecallRequest", RecallRequestSchema);
