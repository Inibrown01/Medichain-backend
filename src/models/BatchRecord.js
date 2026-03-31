const mongoose = require("mongoose");

const BatchRecordSchema = new mongoose.Schema(
  {
    manufacturerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ManufacturerUser",
      required: true,
      index: true
    },
    productName: { type: String, required: true },
    batchNumber: { type: String, required: true, index: true },
    manufacturingDate: { type: Date },
    expiryDate: { type: Date },
    quantity: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "recalled"],
      default: "active",
      index: true
    },
    verificationCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("BatchRecord", BatchRecordSchema);
