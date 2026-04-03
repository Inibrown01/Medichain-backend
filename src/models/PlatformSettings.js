const mongoose = require("mongoose");

const PlatformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    general: {
      platformName: { type: String, default: "MediChain NG" },
      regulatoryAuthority: { type: String, default: "NAFDAC Nigeria" },
      primaryLanguage: { type: String, default: "English (Nigeria)" },
      timezone: { type: String, default: "WAT (UTC+1) - Lagos" },
      maintenanceMode: { type: Boolean, default: false }
    },
    security: {
      twoFactorRequired: { type: Boolean, default: true },
      ipWhitelisting: { type: Boolean, default: false },
      sessionTimeout: { type: Boolean, default: true },
      passwordComplexity: { type: Boolean, default: true }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformSettings", PlatformSettingsSchema);
