const mongoose = require("mongoose");

const ProductApplicationSchema = new mongoose.Schema(
  {
    manufacturerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ManufacturerUser",
      required: true,
      index: true
    },
    productName: { type: String, required: true },
    category: { type: String, default: "" },
    productType: { type: String, default: "" },
    description: { type: String, default: "" },
    nafdacNumber: { type: String, default: "" },
    approvalDate: { type: Date },
    expiryDate: { type: Date },
    location: { type: String, default: "" },
    manufacturerName: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },
    reason: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProductApplication", ProductApplicationSchema);
