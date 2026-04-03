const mongoose = require("mongoose");

const DocumentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    fileName: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending"
    },
    mimeType: { type: String, default: "application/pdf" },
    previewUrl: { type: String, default: "" }
  },
  { _id: false }
);

const TimelineStepSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
    at: { type: Date, required: true },
    tone: { type: String, enum: ["blue", "green", "orange"], default: "blue" }
  },
  { _id: false }
);

const ChecklistItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    done: { type: Boolean, default: false }
  },
  { _id: false }
);

const ProductApplicationSchema = new mongoose.Schema(
  {
    manufacturerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ManufacturerUser",
      index: true
    },
    productName: { type: String, required: true },
    category: { type: String, default: "" },
    productType: { type: String, default: "MEDICINE" },
    description: { type: String, default: "" },
    nafdacNumber: { type: String, default: "" },
    approvalDate: { type: Date },
    expiryDate: { type: Date },
    location: { type: String, default: "" },
    manufacturerName: { type: String, default: "" },
    licenseId: { type: String, default: "" },
    contactEmail: { type: String, default: "" },
    registrationLabel: { type: String, default: "NEW APPLICATION" },
    manufacturerEntityStatus: { type: String, default: "VERIFIED ENTITY" },
    thumbnailUrl: { type: String, default: "" },
    documents: { type: [DocumentSchema], default: [] },
    timeline: { type: [TimelineStepSchema], default: [] },
    checklist: { type: [ChecklistItemSchema], default: [] },
    internalNotes: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "changes_requested"],
      default: "pending",
      index: true
    },
    reason: { type: String, default: "" },
    approvalNote: { type: String, default: "" },
    changesRequestMessage: { type: String, default: "" },
    /** Set when approved and mirrored on-chain / ProductRecord */
    productId: { type: Number, default: null, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProductApplication", ProductApplicationSchema);
