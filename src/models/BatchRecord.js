const mongoose = require("mongoose");

const BatchRecordSchema = new mongoose.Schema(
  {
    manufacturerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ManufacturerUser",
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
    verificationCount: { type: Number, default: 0 },
    /** Admin workflow flags */
    adminFlagged: { type: Boolean, default: false, index: true },
    suspended: { type: Boolean, default: false, index: true },
    qrHash: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("BatchRecord", BatchRecordSchema);
