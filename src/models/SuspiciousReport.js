const mongoose = require("mongoose");

const TimelineStepSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
    at: { type: Date, required: true },
    tone: { type: String, enum: ["red", "blue", "yellow", "green"], default: "blue" }
  },
  { _id: false }
);

const SuspiciousReportSchema = new mongoose.Schema(
  {
    reporterName: { type: String, required: true },
    reporterEmail: { type: String, default: "" },
    productName: { type: String, default: "" },
    batchNumber: { type: String, default: "" },
    location: { type: String, default: "" },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "flagged", "escalated", "dismissed"],
      default: "pending",
      index: true
    },
    reliabilityScore: { type: Number, default: 0 },
    reliabilityNote: { type: String, default: "" },
    recommendedAction: { type: String, default: "" },
    evidenceUrls: { type: [String], default: [] },
    timeline: { type: [TimelineStepSchema], default: [] },
    fieldTeamLead: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SuspiciousReport", SuspiciousReportSchema);
