const mongoose = require("mongoose");

const PermissionsSchema = new mongoose.Schema(
  {
    productApproval: { type: Boolean, default: false },
    recallIssuance: { type: Boolean, default: false },
    userManagement: { type: Boolean, default: false },
    systemSettings: { type: Boolean, default: false },
    auditLogAccess: { type: Boolean, default: false },
    reportsInvestigation: { type: Boolean, default: false }
  },
  { _id: false }
);

const ActivitySchema = new mongoose.Schema(
  {
    kind: { type: String, default: "info" },
    title: { type: String, required: true },
    timeLabel: { type: String, default: "" },
    target: { type: String, default: "" }
  },
  { _id: false }
);

const AdminStaffUserSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    role: {
      type: String,
      enum: ["SUPER_ADMIN", "INSPECTOR", "COMPLIANCE", "ANALYST", "FIELD_AGENT"],
      default: "INSPECTOR"
    },
    department: { type: String, default: "" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    lastLoginAt: { type: Date, default: null },
    securityClearance: { type: String, default: "Level 2" },
    twoFactorEnabled: { type: Boolean, default: true },
    lastIp: { type: String, default: "" },
    primaryDevice: { type: String, default: "" },
    supervisor: { type: String, default: "" },
    officeLocation: { type: String, default: "" },
    deactivationReason: { type: String, default: "" },
    permissions: { type: PermissionsSchema, default: () => ({}) },
    activity: { type: [ActivitySchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminStaffUser", AdminStaffUserSchema);
