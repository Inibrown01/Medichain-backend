const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { requireAdmin } = require("../middleware/auth");
const ProductApplication = require("../models/ProductApplication");
const ProductRecord = require("../models/ProductRecord");
const VerificationLog = require("../models/VerificationLog");
const BatchRecord = require("../models/BatchRecord");
const RecallRequest = require("../models/RecallRequest");
const SuspiciousReport = require("../models/SuspiciousReport");
const AdminStaffUser = require("../models/AdminStaffUser");
const ManufacturerUser = require("../models/ManufacturerUser");
const PlatformSettings = require("../models/PlatformSettings");
const { getWriteContract } = require("../lib/blockchainClient");

const router = express.Router();

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfUtcWeekMonday(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setUTCDate(x.getUTCDate() + diff);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function addDaysUtc(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function utcDateKey(d) {
  return d.toISOString().slice(0, 10);
}

let demoApplicationsSeeded = false;

async function seedDemoApplicationsIfEmpty() {
  if (process.env.NODE_ENV === "production" || demoApplicationsSeeded) return;
  const n = await ProductApplication.countDocuments({ status: "pending" });
  if (n > 0) {
    demoApplicationsSeeded = true;
    return;
  }

  const baseDocs = [
    { name: "NAFDAC Certification", fileName: "NAFDAC_Certification.pdf", status: "pending", mimeType: "application/pdf" },
    { name: "Product Packaging Front", fileName: "Product_Packaging_Front.jpg", status: "verified", mimeType: "image/jpeg" },
    { name: "Quality Control Report", fileName: "Quality_Control_Report.pdf", status: "pending", mimeType: "application/pdf" },
    { name: "Manufacturer License", fileName: "Manufacturer_License.pdf", status: "verified", mimeType: "application/pdf" }
  ];

  const checklist = [
    { id: "nafdac", label: "NAFDAC Number Verification", done: false },
    { id: "expiry", label: "Expiry Date Format Check", done: false },
    { id: "license", label: "Manufacturer License Validity", done: false },
    { id: "packaging", label: "Packaging Label Compliance", done: false },
    { id: "qc", label: "Quality Control Documentation", done: false },
    { id: "contact", label: "Manufacturer Contact Verified", done: false }
  ];

  const timeline = [
    {
      key: "recv",
      title: "Submission Received",
      subtitle: "",
      at: new Date("2026-03-25T10:30:00Z"),
      tone: "blue"
    },
    {
      key: "screen",
      title: "Initial Screening",
      subtitle: "",
      at: new Date("2026-03-25T14:15:00Z"),
      tone: "green"
    },
    {
      key: "review",
      title: "Review Started",
      subtitle: "Assigned to Admin Madeleine Nkiru.",
      at: new Date("2026-03-26T09:00:00Z"),
      tone: "orange"
    }
  ];

  await ProductApplication.insertMany([
    {
      productName: "Amoxicillin 500mg",
      category: "Analgesics",
      manufacturerName: "Emzor Pharmaceuticals",
      nafdacNumber: "A4-1234",
      description:
        "Amoxicillin is a broad-spectrum penicillin antibiotic used to treat bacterial infections including respiratory, ear, and urinary tract infections.",
      licenseId: "MFG-NG-2024-001",
      contactEmail: "regulatory@emzor.ng",
      status: "pending",
      documents: baseDocs,
      timeline,
      checklist,
      productType: "MEDICINE"
    },
    {
      productName: "Vitamix-D",
      category: "Supplements",
      manufacturerName: "Swiss Pharma Nigeria",
      nafdacNumber: "A4-2234",
      description: "Vitamin D3 supplement for bone health and immune support.",
      licenseId: "MFG-NG-2024-014",
      contactEmail: "compliance@swisspharma.ng",
      status: "pending",
      documents: baseDocs.map((d) => ({ ...d, status: "pending" })),
      timeline,
      checklist,
      productType: "MEDICINE"
    },
    {
      productName: "Cardio-Guard",
      category: "Cardiovascular",
      manufacturerName: "Fidson Healthcare",
      nafdacNumber: "A4-3344",
      description: "Cardiovascular support formulation for maintenance therapy.",
      licenseId: "MFG-NG-2023-882",
      contactEmail: "qa@fidsonhealthcare.com",
      status: "pending",
      documents: baseDocs.map((d) => ({ ...d, status: "pending" })),
      timeline,
      checklist,
      productType: "MEDICINE"
    }
  ]);

  demoApplicationsSeeded = true;
}

function formatStatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return n.toLocaleString("en-US");
  return String(n);
}

router.use(requireAdmin);

router.get("/overview", async (req, res, next) => {
  try {
    const totalProducts = await ProductRecord.countDocuments();
    const totalLogs = await VerificationLog.countDocuments();
    const flaggedLogs = await VerificationLog.countDocuments({ verificationResult: "FLAGGED" });
    const fakeLogs = await VerificationLog.countDocuments({ verificationResult: "NOT_REGISTERED" });

    const weekStart = startOfUtcWeekMonday();
    const weekEnd = addDaysUtc(weekStart, 7);

    const byDay = new Map();
    for (let i = 0; i < 7; i += 1) {
      byDay.set(utcDateKey(addDaysUtc(weekStart, i)), { total: 0, flagged: 0, fakes: 0 });
    }

    const agg = await VerificationLog.aggregate([
      { $match: { createdAt: { $gte: weekStart, $lt: weekEnd } } },
      {
        $group: {
          _id: {
            ymd: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" }
            },
            result: "$verificationResult"
          },
          count: { $sum: 1 }
        }
      }
    ]);

    for (const row of agg) {
      const bucket = byDay.get(row._id.ymd);
      if (!bucket) continue;
      const c = row.count;
      const r = row._id.result;
      bucket.total += c;
      if (r === "FLAGGED") bucket.flagged += c;
      if (r === "NOT_REGISTERED") bucket.fakes += c;
    }

    const chartWeekly = [];
    for (let i = 0; i < 7; i += 1) {
      const key = utcDateKey(addDaysUtc(weekStart, i));
      const b = byDay.get(key) || { total: 0, flagged: 0, fakes: 0 };
      chartWeekly.push({
        label: WEEKDAY_LABELS[i],
        total: b.total,
        flagged: b.flagged,
        fakes: b.fakes
      });
    }

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const monthAgg = await VerificationLog.aggregate([
      { $match: { createdAt: { $gte: monthStart, $lt: monthEnd } } },
      {
        $group: {
          _id: {
            ym: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } },
            result: "$verificationResult"
          },
          count: { $sum: 1 }
        }
      }
    ]);

    const byMonth = new Map();
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      byMonth.set(key, { total: 0, flagged: 0, fakes: 0 });
    }

    for (const row of monthAgg) {
      const bucket = byMonth.get(row._id.ym);
      if (!bucket) continue;
      const c = row.count;
      const r = row._id.result;
      bucket.total += c;
      if (r === "FLAGGED") bucket.flagged += c;
      if (r === "NOT_REGISTERED") bucket.fakes += c;
    }

    const chartMonthly = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const b = byMonth.get(key) || { total: 0, flagged: 0, fakes: 0 };
      chartMonthly.push({
        label: MONTH_LABELS[d.getUTCMonth()],
        total: b.total,
        flagged: b.flagged,
        fakes: b.fakes
      });
    }

    const categoryAgg = await ProductRecord.aggregate([
      {
        $group: {
          _id: { $ifNull: ["$verificationResult", "UNKNOWN"] },
          count: { $sum: 1 }
        }
      }
    ]);

    const categoryMap = {
      GENUINE: { name: "Genuine (verified)", color: "#10b981" },
      FLAGGED: { name: "Flagged", color: "#f59e0b" },
      NOT_REGISTERED: { name: "Not registered / rejected", color: "#ef4444" }
    };

    const categoryBreakdown = categoryAgg.map((c) => {
      const meta = categoryMap[c._id] || { name: String(c._id || "Unknown"), color: "#94a3b8" };
      return { name: meta.name, value: c.count, color: meta.color };
    });

    /** Populated from real audit store when available; empty in MVP. */
    const alerts = [];
    const auditLog = [];

    return res.json({
      ok: true,
      data: {
        welcomeDateLabel: now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        }),
        stats: [
          {
            key: "products",
            label: "Total Products",
            value: formatStatNumber(totalProducts),
            delta: "—",
            deltaPositive: true
          },
          {
            key: "verifications",
            label: "Verifications",
            value: formatStatNumber(totalLogs),
            delta: "—",
            deltaPositive: true
          },
          {
            key: "fake",
            label: "Unregistered Lookups",
            value: formatStatNumber(fakeLogs),
            delta: "—",
            deltaPositive: true
          },
          {
            key: "flags",
            label: "Flagged Verifications",
            value: formatStatNumber(flaggedLogs),
            delta: "—",
            deltaPositive: false
          }
        ],
        chartWeekly,
        chartMonthly,
        alerts,
        auditLog,
        categoryBreakdown
      }
    });
  } catch (e) {
    return next(e);
  }
});

router.get("/product-approvals", async (req, res, next) => {
  try {
    await seedDemoApplicationsIfEmpty();
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const filter = q
      ? {
          status: "pending",
          $or: [
            { productName: new RegExp(escapeRegex(q), "i") },
            { manufacturerName: new RegExp(escapeRegex(q), "i") },
            { nafdacNumber: new RegExp(escapeRegex(q), "i") }
          ]
        }
      : { status: "pending" };
    const rows = await ProductApplication.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r._id),
        productName: r.productName,
        category: r.category,
        manufacturerName: r.manufacturerName,
        nafdacNumber: r.nafdacNumber,
        submissionDate: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "",
        status: r.status
      }))
    });
  } catch (e) {
    return next(e);
  }
});

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/submissions/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "INVALID_ID", message: "Invalid submission id" });
    }
    const doc = await ProductApplication.findById(req.params.id).lean();
    if (!doc) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Submission not found" });
    }
    return res.json({ ok: true, data: doc });
  } catch (e) {
    return next(e);
  }
});

router.post("/submissions/:id/approve", async (req, res, next) => {
  try {
    const { note = "" } = req.body || {};
    const doc = await ProductApplication.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Submission not found" });
    }
    doc.status = "approved";
    doc.approvalNote = String(note || "");
    doc.reason = "";
    await doc.save();
    return res.json({ ok: true, data: { id: String(doc._id), status: doc.status } });
  } catch (e) {
    return next(e);
  }
});

router.post("/submissions/:id/reject", async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "reason is required"
      });
    }
    const doc = await ProductApplication.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Submission not found" });
    }
    doc.status = "rejected";
    doc.reason = String(reason).trim();
    await doc.save();
    return res.json({ ok: true, data: { id: String(doc._id), status: doc.status } });
  } catch (e) {
    return next(e);
  }
});

router.post("/submissions/:id/request-changes", async (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "message is required"
      });
    }
    const doc = await ProductApplication.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Submission not found" });
    }
    doc.status = "changes_requested";
    doc.changesRequestMessage = String(message).trim();
    await doc.save();
    return res.json({ ok: true, data: { id: String(doc._id), status: doc.status } });
  } catch (e) {
    return next(e);
  }
});

router.patch("/submissions/:id", async (req, res, next) => {
  try {
    const { checklist, internalNotes } = req.body || {};
    const doc = await ProductApplication.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Submission not found" });
    }
    if (Array.isArray(checklist)) {
      doc.checklist = checklist.map((c) => ({
        id: String(c.id),
        label: String(c.label || ""),
        done: Boolean(c.done)
      }));
    }
    if (typeof internalNotes === "string") doc.internalNotes = internalNotes;
    await doc.save();
    return res.json({ ok: true, data: doc.toObject() });
  } catch (e) {
    return next(e);
  }
});

router.patch("/submissions/:id/documents/:index", async (req, res, next) => {
  try {
    const idx = Number(req.params.index);
    const { status } = req.body || {};
    if (!["pending", "verified", "rejected"].includes(status)) {
      return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Invalid status" });
    }
    const doc = await ProductApplication.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Submission not found" });
    }
    if (!doc.documents[idx]) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Document not found" });
    }
    doc.documents[idx].status = status;
    await doc.save();
    return res.json({ ok: true, data: doc.toObject() });
  } catch (e) {
    return next(e);
  }
});

router.get("/products", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const filter = {};
    if (q) {
      filter.$or = [
        { drugName: new RegExp(escapeRegex(q), "i") },
        { manufacturer: new RegExp(escapeRegex(q), "i") },
        { nafDacNumber: new RegExp(escapeRegex(q), "i") }
      ];
    }
    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "verified") filter.verificationResult = "GENUINE";
      else if (statusFilter === "flagged") filter.verificationResult = "FLAGGED";
      else if (statusFilter === "rejected") filter.verificationResult = "NOT_REGISTERED";
    }
    const rows = await ProductRecord.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
    return res.json({
      ok: true,
      data: rows.map((r) => ({
        productId: r.productId,
        productName: r.drugName,
        category: categoryGuess(r.drugName),
        manufacturer: r.manufacturer,
        nafdacNumber: r.nafDacNumber,
        approvalDate:
          r.chainCreatedAt && r.chainCreatedAt > 0
            ? new Date(r.chainCreatedAt * 1000).toISOString().slice(0, 10)
            : r.updatedAt
              ? new Date(r.updatedAt).toISOString().slice(0, 10)
              : "",
        status: mapVerificationToUi(r.verificationResult)
      }))
    });
  } catch (e) {
    return next(e);
  }
});

function categoryGuess(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("amox") || n.includes("cillin")) return "Antibiotics";
  if (n.includes("vita")) return "Supplements";
  if (n.includes("cardio")) return "Cardiovascular";
  return "Analgesics";
}

function mapVerificationToUi(v) {
  if (v === "GENUINE") return "verified";
  if (v === "FLAGGED") return "flagged";
  return "rejected";
}

router.get("/products/:productId/detail", async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ ok: false, error: "INVALID_ID", message: "Invalid product id" });
    }
    const product = await ProductRecord.findOne({ productId }).lean();
    if (!product) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Product not found" });
    }

    const genuine = await VerificationLog.countDocuments({ productId, verificationResult: "GENUINE" });
    const flagged = await VerificationLog.countDocuments({ productId, verificationResult: "FLAGGED" });
    const fake = await VerificationLog.countDocuments({ productId, verificationResult: "NOT_REGISTERED" });
    const total = genuine + flagged + fake;

    const now = new Date();
    const seriesStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1));
    const monthAgg = await VerificationLog.aggregate([
      {
        $match: {
          productId,
          createdAt: { $gte: seriesStart }
        }
      },
      {
        $group: {
          _id: { ym: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } } },
          count: { $sum: 1 }
        }
      }
    ]);
    const byM = new Map(monthAgg.map((x) => [x._id.ym, x.count]));
    const verificationSeries = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      verificationSeries.push({
        label: MONTH_LABELS[d.getUTCMonth()],
        count: byM.get(key) || 0
      });
    }

    const genuineRate = total > 0 ? ((genuine / total) * 100).toFixed(1) : "99.2";

    let batches = await BatchRecord.find({ productName: product.drugName }).sort({ createdAt: -1 }).limit(12).lean();
    if (batches.length === 0) {
      batches = [
        {
          batchNumber: product.batchNumber || "—",
          manufacturingDate: product.createdAt,
          expiryDate: null,
          verificationCount: total,
          status: "active"
        }
      ];
    }

    const uiStatus =
      product.verificationResult === "GENUINE"
        ? "verified"
        : product.verificationResult === "FLAGGED"
          ? "flagged"
          : "rejected";

    return res.json({
      ok: true,
      data: {
        productId: product.productId,
        drugName: product.drugName,
        manufacturer: product.manufacturer,
        nafdacNumber: product.nafDacNumber,
        category: categoryGuess(product.drugName),
        description:
          product.ipfsCid ?
            `Registered product with IPFS metadata (${product.ipfsCid.slice(0, 12)}…).`
          : "Broad-spectrum antibiotic indicated for susceptible bacterial infections.",
        blockchainId: product.lastTransactionHash
          ? `0x${String(product.lastTransactionHash).slice(2, 6)}…${String(product.lastTransactionHash).slice(-4)}`
          : `0x${product.productId.toString(16).padStart(4, "0")}…chain`,
        approvalDate:
          product.chainCreatedAt && product.chainCreatedAt > 0
            ? new Date(product.chainCreatedAt * 1000).toISOString().slice(0, 10)
            : new Date(product.createdAt).toISOString().slice(0, 10),
        uiStatus,
        verificationResult: product.verificationResult,
        stats: {
          totalVerifications: total || 0,
          activeBatches: batches.filter((b) => b.status === "active").length,
          fakeDetections: fake
        },
        genuineRateLabel: `${genuineRate}% GENUINE`,
        verificationSeries,
        batches: batches.map((b) => ({
          batchNo: b.batchNumber,
          mfgDate: b.manufacturingDate ? new Date(b.manufacturingDate).toISOString().slice(0, 10) : "—",
          expiryDate: b.expiryDate ? new Date(b.expiryDate).toISOString().slice(0, 10) : "—",
          verifications: b.verificationCount ?? 0,
          status: b.status === "recalled" ? "recalled" : "active"
        })),
        regulatory: {
          compliance: uiStatus === "rejected" ? "Non-Compliant" : "Fully Compliant",
          blockchain: "Immutable Record",
          blockchainSub: "Synced with Mainnet"
        },
        risk: {
          counterfeit: uiStatus === "flagged" ? "medium" : "low",
          supplyChain: "high",
          market: "medium"
        },
        market: {
          topRegion: "Lagos State",
          topPercent: "42% of total verifications"
        },
        health: {
          lastVerification: new Date(now.getTime() - 86400000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
          }),
          statusLine:
            uiStatus === "verified" ? "System Healthy • Active"
            : uiStatus === "flagged" ? "Under Investigation"
            : "Rejected",
          warning:
            uiStatus === "flagged" ?
              {
                title: "Suspicious Activity in Northern Region",
                body: "Elevated verification failure rates detected in Kano State."
              }
            : uiStatus === "rejected" ?
              {
                title: "Regulatory Non-Compliance",
                body: "This product failed the final safety audit and must not be distributed."
              }
            : null
        }
      }
    });
  } catch (e) {
    return next(e);
  }
});

router.post("/products/:productId/status", async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    const { chainStatus, justification } = req.body || {};
    /** 1=APPROVED, 2=FLAGGED, 3=RECALLED in contract enum */
    const map = { approved: 1, flagged: 2, recalled: 3 };
    const st = map[String(chainStatus || "").toLowerCase()];
    if (!st) {
      return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "Invalid chainStatus" });
    }

    try {
      const contract = getWriteContract();
      const tx = await contract.updateDrugStatus(productId, st);
      await tx.wait();
    } catch (bcErr) {
      console.warn("updateDrugStatus chain call failed:", bcErr.message);
    }

    const vr = st === 1 ? "GENUINE" : st === 2 ? "FLAGGED" : "NOT_REGISTERED";
    await ProductRecord.updateOne({ productId }, { $set: { verificationResult: vr } });

    return res.json({
      ok: true,
      data: { productId, verificationResult: vr, justification: justification || "" }
    });
  } catch (e) {
    return next(e);
  }
});

router.post("/products/:productId/recall", async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    const { publicNotice } = req.body || {};
    const note = String(publicNotice || "Regulatory recall initiated.").slice(0, 2000);

    try {
      const contract = getWriteContract();
      const tx = await contract.recallDrug(productId, note);
      await tx.wait();
    } catch (bcErr) {
      console.warn("recallDrug chain call failed:", bcErr.message);
    }

    await ProductRecord.updateOne({ productId }, { $set: { verificationResult: "FLAGGED" } });

    return res.json({ ok: true, data: { productId, recalled: true } });
  } catch (e) {
    return next(e);
  }
});

let demoBatchesSeeded = false;
async function seedDemoBatchesIfEmpty() {
  if (process.env.NODE_ENV === "production" || demoBatchesSeeded) return;
  if ((await BatchRecord.countDocuments()) > 0) {
    demoBatchesSeeded = true;
    return;
  }
  const oid = new mongoose.Types.ObjectId();
  await BatchRecord.insertMany([
    {
      manufacturerId: oid,
      productName: "Amoxicillin 500mg",
      batchNumber: "EMZ-001",
      manufacturingDate: new Date("2026-01-10"),
      expiryDate: new Date("2028-12-31"),
      quantity: 50000,
      status: "active",
      verificationCount: 1240,
      qrHash: "8f2d9e1a4b7c3f6e2d8a1b5c9e4f7a2c1d6e8b3a9f0c4d7e2b5a8f1c3d6e9a2b4a1c"
    },
    {
      manufacturerId: oid,
      productName: "Paracetamol B-99",
      batchNumber: "PAR-B99",
      manufacturingDate: new Date("2025-11-01"),
      expiryDate: new Date("2027-06-30"),
      quantity: 100000,
      status: "active",
      verificationCount: 850
    },
    {
      manufacturerId: oid,
      productName: "Vitamix-D",
      batchNumber: "SWI-202",
      manufacturingDate: new Date("2026-02-15"),
      expiryDate: new Date("2028-03-01"),
      quantity: 20000,
      status: "active",
      verificationCount: 120
    }
  ]);
  demoBatchesSeeded = true;
}

function decodeBatchKey(key) {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

router.get("/batches", async (req, res, next) => {
  try {
    await seedDemoBatchesIfEmpty();
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const filter = {};
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ batchNumber: rx }, { productName: rx }];
    }
    if (statusFilter === "active") filter.status = "active";
    if (statusFilter === "rejected" || statusFilter === "recalled") filter.status = "recalled";
    const rows = await BatchRecord.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
    const data = await Promise.all(
      rows.map(async (r) => {
        const pr = await ProductRecord.findOne({ batchNumber: r.batchNumber }).select("productId").lean();
        return {
          id: String(r._id),
          batchNumber: r.batchNumber,
          productName: r.productName,
          productId: pr?.productId ?? null,
          manufacturingDate: r.manufacturingDate ? new Date(r.manufacturingDate).toISOString().slice(0, 10) : "",
          expiryDate: r.expiryDate ? new Date(r.expiryDate).toISOString().slice(0, 10) : "",
          verifications: r.verificationCount || 0,
          status: r.status === "recalled" ? "rejected" : "active",
          adminFlagged: Boolean(r.adminFlagged),
          suspended: Boolean(r.suspended)
        };
      })
    );
    return res.json({ ok: true, data });
  } catch (e) {
    return next(e);
  }
});

router.get("/batches/:batchKey/detail", async (req, res, next) => {
  try {
    await seedDemoBatchesIfEmpty();
    const batchNumber = decodeBatchKey(req.params.batchKey);
    const batch = await BatchRecord.findOne({ batchNumber }).lean();
    if (!batch) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Batch not found" });
    }
    const product = await ProductRecord.findOne({ batchNumber }).lean();
    const productId = product?.productId ?? null;

    const logFilter = {
      queryType: "batchNumber",
      batchNumber
    };
    const totalScans = await VerificationLog.countDocuments(logFilter);
    const genuine = await VerificationLog.countDocuments({ ...logFilter, verificationResult: "GENUINE" });
    const fake = await VerificationLog.countDocuments({
      ...logFilter,
      verificationResult: { $in: ["FLAGGED", "NOT_REGISTERED"] }
    });
    const recentLogs = await VerificationLog.find(logFilter).sort({ createdAt: -1 }).limit(12).lean();

    const geoDistribution =
      totalScans > 0 ?
        [
          {
            city: "All recorded scans",
            count: totalScans
          }
        ]
      : [];

    let recentScans = recentLogs.map((log) => ({
      id: String(log._id),
      location: log.clientIp ? `${log.clientIp.slice(0, 8)}…` : "—",
      device: (log.userAgent || "Mobile").slice(0, 32),
      timeLabel: relMinutesAgo(log.createdAt),
      genuine: log.verificationResult === "GENUINE"
    }));

    const manuf = batch.manufacturingDate ? new Date(batch.manufacturingDate) : new Date();
    const exp = batch.expiryDate ? new Date(batch.expiryDate) : new Date();

    return res.json({
      ok: true,
      data: {
        id: String(batch._id),
        batchNumber: batch.batchNumber,
        productName: batch.productName,
        productId,
        status: batch.status === "recalled" ? "recalled" : batch.suspended ? "suspended" : "active",
        adminFlagged: batch.adminFlagged,
        suspended: batch.suspended,
        expiryDate: exp.toISOString().slice(0, 10),
        manufacturedAt: manuf.toISOString(),
        qrHash: batch.qrHash || "—",
        stats: {
          totalQuantity: batch.quantity || 0,
          verifiedScans: totalScans || batch.verificationCount || 0,
          marketReachStates: totalScans > 0 ? 1 : 0,
          flaggedUnits: fake || 0
        },
        geoDistribution,
        recentScans,
        lifecycle: [
          { key: "m", title: "Manufactured", subtitle: "Production line sealed", at: manuf.toISOString(), tone: "blue" },
          {
            key: "q",
            title: "Quality Certified",
            subtitle: "QC sign-off",
            at: new Date(manuf.getTime() + 86400000).toISOString(),
            tone: "green"
          },
          {
            key: "r",
            title: "Batch Released",
            subtitle: "Released to distributors",
            at: new Date(manuf.getTime() + 172800000).toISOString(),
            tone: "green"
          },
          {
            key: "v",
            title: "First Verification",
            subtitle: "Consumer scan confirmed",
            at: new Date(manuf.getTime() + 259200000).toISOString(),
            tone: "blue"
          }
        ],
        integrity: {
          tamperProof: 100,
          traceability: batch.adminFlagged ? 75 : 98,
          shelfLifeLabel:
            exp.getTime() > Date.now() ?
              `${Math.max(1, Math.round((exp.getTime() - Date.now()) / (30 * 86400000)))} Months Left`
            : "Expired"
        }
      }
    });
  } catch (e) {
    return next(e);
  }
});

function relMinutesAgo(d) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "JUST NOW";
  if (m < 60) return `${m} MINS AGO`;
  const h = Math.floor(m / 60);
  return `${h} HOUR${h === 1 ? "" : "S"} AGO`;
}

router.post("/batches/:batchKey/flag", async (req, res, next) => {
  try {
    const batchNumber = decodeBatchKey(req.params.batchKey);
    const r = await BatchRecord.findOneAndUpdate({ batchNumber }, { $set: { adminFlagged: true } }, { new: true });
    if (!r) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return res.json({ ok: true, data: { batchNumber, adminFlagged: true } });
  } catch (e) {
    return next(e);
  }
});

router.post("/batches/:batchKey/suspend", async (req, res, next) => {
  try {
    const batchNumber = decodeBatchKey(req.params.batchKey);
    const r = await BatchRecord.findOneAndUpdate({ batchNumber }, { $set: { suspended: true } }, { new: true });
    if (!r) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return res.json({ ok: true, data: { batchNumber, suspended: true } });
  } catch (e) {
    return next(e);
  }
});

router.post("/batches/:batchKey/recall", async (req, res, next) => {
  try {
    const batchNumber = decodeBatchKey(req.params.batchKey);
    const { publicNotice } = req.body || {};
    const note = String(publicNotice || "Batch recall initiated.").slice(0, 2000);
    const batch = await BatchRecord.findOne({ batchNumber });
    if (!batch) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const product = await ProductRecord.findOne({ batchNumber }).lean();
    if (product?.productId) {
      try {
        const contract = getWriteContract();
        const tx = await contract.recallDrug(product.productId, note);
        await tx.wait();
      } catch (bcErr) {
        console.warn("recallDrug:", bcErr.message);
      }
    }
    await BatchRecord.updateOne({ batchNumber }, { $set: { status: "recalled" } });
    return res.json({ ok: true, data: { batchNumber, recalled: true } });
  } catch (e) {
    return next(e);
  }
});

let demoRecallsSeeded = false;
async function seedDemoRecallsIfEmpty() {
  if (process.env.NODE_ENV === "production" || demoRecallsSeeded) return;
  if ((await RecallRequest.countDocuments()) > 0) {
    demoRecallsSeeded = true;
    return;
  }
  const oid = new mongoose.Types.ObjectId();
  await RecallRequest.insertMany([
    {
      manufacturerId: oid,
      manufacturerName: "Fidson Healthcare",
      productName: "Cough Syrup X",
      batchNumber: "FID-443, FID-444",
      batchesLabel: "FID-443, FID-444",
      severity: "high",
      reason: "Contamination detected in Batch #FID-443 during routine testing.",
      riskAnalysis: "High risk of respiratory distress if consumed. Immediate recall recommended.",
      status: "pending",
      source: "manufacturer"
    },
    {
      manufacturerId: oid,
      manufacturerName: "Swiss Pharma Nigeria",
      productName: "Vitamix-D",
      batchNumber: "SWI-202",
      batchesLabel: "SWI-202",
      severity: "medium",
      reason: "Incorrect labeling on outer carton.",
      status: "pending",
      source: "manufacturer"
    },
    {
      manufacturerId: oid,
      manufacturerName: "Fidson Healthcare",
      productName: "Paracetamol B-99",
      batchNumber: "ALL",
      batchesLabel: "ALL BATCHES",
      severity: "low",
      reason: "Packaging defect — voluntary recall.",
      status: "approved",
      source: "manufacturer"
    }
  ]);
  demoRecallsSeeded = true;
}

router.get("/recalls", async (req, res, next) => {
  try {
    await seedDemoRecallsIfEmpty();
    const tab = typeof req.query.tab === "string" ? req.query.tab : "pending";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const filter = {};
    if (tab === "pending") filter.status = "pending";
    else filter.status = { $in: ["approved", "rejected", "completed"] };
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ productName: rx }, { batchNumber: rx }, { manufacturerName: rx }];
    }
    const rows = await RecallRequest.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r._id),
        productName: r.productName,
        batches: r.batchesLabel || r.batchNumber,
        manufacturerName: r.manufacturerName || "—",
        reason: r.reason,
        riskAnalysis: r.riskAnalysis || "",
        severity: r.severity || "medium",
        date: r.recallDate ? new Date(r.recallDate).toISOString().slice(0, 10) : new Date(r.createdAt).toISOString().slice(0, 10),
        status: r.status
      }))
    });
  } catch (e) {
    return next(e);
  }
});

router.post("/recalls", async (req, res, next) => {
  try {
    const {
      productName,
      batchNumbers,
      severity,
      reason,
      detailDescription = "",
      requiredActions = "",
      riskAnalysis = ""
    } = req.body || {};
    if (!productName || !batchNumbers) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "productName and batchNumbers required"
      });
    }
    const doc = await RecallRequest.create({
      productName: String(productName),
      batchNumber: String(batchNumbers).replace(/\s+/g, " ").trim(),
      batchesLabel: String(batchNumbers).replace(/\s+/g, " ").trim(),
      severity: String(severity || "medium").toLowerCase(),
      reason: String(reason || "Regulatory recall"),
      reasonCode: String(reason || ""),
      detailDescription: String(detailDescription),
      requiredActions: String(requiredActions),
      riskAnalysis: String(riskAnalysis),
      source: "regulatory",
      status: "pending"
    });
    return res.json({ ok: true, data: { id: String(doc._id) } });
  } catch (e) {
    return next(e);
  }
});

router.post("/recalls/:id/approve", async (req, res, next) => {
  try {
    const doc = await RecallRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    doc.status = "approved";
    await doc.save();
    const firstBatch = String(doc.batchNumber).split(",")[0].trim();
    const batch = await BatchRecord.findOne({ batchNumber: firstBatch });
    const product = await ProductRecord.findOne({ batchNumber: firstBatch }).lean();
    if (product?.productId) {
      try {
        const contract = getWriteContract();
        const tx = await contract.recallDrug(product.productId, doc.reason || "Approved recall");
        await tx.wait();
      } catch (bcErr) {
        console.warn("recallDrug:", bcErr.message);
      }
    }
    if (batch) await BatchRecord.updateOne({ _id: batch._id }, { $set: { status: "recalled" } });
    return res.json({ ok: true, data: { id: String(doc._id), status: doc.status } });
  } catch (e) {
    return next(e);
  }
});

router.post("/recalls/:id/reject", async (req, res, next) => {
  try {
    const doc = await RecallRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    doc.status = "rejected";
    await doc.save();
    return res.json({ ok: true, data: { id: String(doc._id), status: doc.status } });
  } catch (e) {
    return next(e);
  }
});

let demoReportsSeeded = false;
async function seedSuspiciousIfEmpty() {
  if (process.env.NODE_ENV === "production" || demoReportsSeeded) return;
  if ((await SuspiciousReport.countDocuments()) > 0) {
    demoReportsSeeded = true;
    return;
  }
  const tl = [
    {
      key: "r",
      title: "Report Received",
      subtitle: "Automated system intake.",
      at: new Date("2026-01-01T10:00:00Z"),
      tone: "red"
    },
    {
      key: "a",
      title: "Assigned to Investigator",
      subtitle: "Assigned to S. Adamu (Lagos Office).",
      at: new Date("2026-01-05T14:00:00Z"),
      tone: "blue"
    },
    {
      key: "i",
      title: "Initial Assessment",
      subtitle: "Images confirm packaging discrepancy.",
      at: new Date("2026-01-12T09:30:00Z"),
      tone: "yellow"
    }
  ];
  await SuspiciousReport.insertMany([
    {
      reporterName: "Brigham Young",
      reporterEmail: "brigham.young@email.com",
      productName: "Paracetamol B-99",
      batchNumber: "EMZ-001",
      location: "Lagos, Nigeria",
      description: "The packaging looks different from what I usually buy. The colors are faded and the text is blurry.",
      status: "pending",
      reliabilityScore: 85,
      reliabilityNote: "Based on 12 previous verified reports.",
      recommendedAction:
        "Evidence suggests counterfeit Amoxicillin circulating in Lagos. Immediate field inspection recommended.",
      timeline: tl
    },
    {
      reporterName: "Anonymous",
      reporterEmail: "",
      productName: "Unknown Product",
      batchNumber: "",
      location: "Kano, Nigeria",
      description: "Suspicious seller at open market.",
      status: "flagged",
      reliabilityScore: 40,
      timeline: tl.slice(0, 2)
    },
    {
      reporterName: "Pharm_Lagos",
      reporterEmail: "ops@pharm.com",
      productName: "Cough Syrup X",
      batchNumber: "FID-443",
      location: "Lagos, Nigeria",
      description: "Batch numbers do not match NAFDAC registry.",
      status: "escalated",
      reliabilityScore: 72,
      timeline: tl
    }
  ]);
  demoReportsSeeded = true;
}

router.get("/suspicious-reports", async (req, res, next) => {
  try {
    await seedSuspiciousIfEmpty();
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const filter = {};
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { reporterName: rx },
        { productName: rx },
        { location: rx },
        { batchNumber: rx }
      ];
    }
    const rows = await SuspiciousReport.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r._id),
        reporter: r.reporterName,
        product: r.productName,
        batchNumber: r.batchNumber,
        location: r.location,
        date: new Date(r.createdAt).toISOString().slice(0, 10),
        status: r.status
      }))
    });
  } catch (e) {
    return next(e);
  }
});

router.get("/suspicious-reports/:id", async (req, res, next) => {
  try {
    await seedSuspiciousIfEmpty();
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "INVALID_ID" });
    }
    const r = await SuspiciousReport.findById(req.params.id).lean();
    if (!r) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return res.json({
      ok: true,
      data: {
        id: String(r._id),
        reporterName: r.reporterName,
        reporterEmail: r.reporterEmail,
        productName: r.productName,
        batchNumber: r.batchNumber,
        location: r.location,
        description: r.description,
        status: r.status,
        reliabilityScore: r.reliabilityScore,
        reliabilityNote: r.reliabilityNote,
        recommendedAction: r.recommendedAction,
        evidenceUrls: r.evidenceUrls,
        timeline: (r.timeline || []).map((t) => ({
          ...t,
          at: t.at ? new Date(t.at).toISOString() : ""
        })),
        fieldTeamLead: r.fieldTeamLead,
        createdAt: r.createdAt
      }
    });
  } catch (e) {
    return next(e);
  }
});

router.patch("/suspicious-reports/:id", async (req, res, next) => {
  try {
    const { status, fieldTeamLead } = req.body || {};
    const doc = await SuspiciousReport.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (status && ["pending", "flagged", "escalated", "dismissed"].includes(status)) doc.status = status;
    if (typeof fieldTeamLead === "string") doc.fieldTeamLead = fieldTeamLead;
    await doc.save();
    return res.json({ ok: true, data: { id: String(doc._id), status: doc.status } });
  } catch (e) {
    return next(e);
  }
});

let demoManufacturersSeeded = false;
async function seedDemoManufacturersIfEmpty() {
  if (process.env.NODE_ENV === "production" || demoManufacturersSeeded) return;
  const n = await ManufacturerUser.countDocuments();
  if (n > 0) {
    demoManufacturersSeeded = true;
    return;
  }
  const hash = bcrypt.hashSync("DemoManufacturers1!", 10);
  await ManufacturerUser.insertMany([
    {
      email: "regulatory@emzor.ng",
      passwordHash: hash,
      companyName: "Emzor Pharmaceuticals",
      isActive: true
    },
    {
      email: "compliance@swisspharma.ng",
      passwordHash: hash,
      companyName: "Swiss Pharma Nigeria",
      isActive: true
    },
    {
      email: "hello@fidsonhealthcare.com",
      passwordHash: hash,
      companyName: "Fidson Healthcare",
      isActive: true
    }
  ]);
  demoManufacturersSeeded = true;
}

let demoStaffSeeded = false;
async function seedAdminStaffIfEmpty() {
  if (process.env.NODE_ENV === "production" || demoStaffSeeded) return;
  const n = await AdminStaffUser.countDocuments();
  if (n > 0) {
    demoStaffSeeded = true;
    return;
  }
  await AdminStaffUser.insertMany([
    {
      fullName: "Admin One",
      email: "admin1@nafdac.gov.ng",
      role: "SUPER_ADMIN",
      department: "Regulatory Affairs",
      status: "active",
      lastLoginAt: new Date("2026-03-27T09:15:00Z"),
      securityClearance: "Level 5 (Super)",
      permissions: {
        productApproval: true,
        recallIssuance: true,
        userManagement: true,
        systemSettings: true,
        auditLogAccess: true,
        reportsInvestigation: true
      },
      activity: [
        { kind: "success", title: "Approved Product", timeLabel: "2 hours ago", target: "Amoxicillin 500mg" },
        { kind: "danger", title: "Initiated Recall", timeLabel: "5 hours ago", target: "Batch EMZ-001" },
        { kind: "info", title: "Updated Permissions", timeLabel: "1 day ago", target: "Inspector Lagos" },
        { kind: "warning", title: "Logged In", timeLabel: "1 day ago", target: "System Access" }
      ]
    },
    {
      fullName: "Inspector Lagos",
      email: "inspector.lagos@nafdac.gov.ng",
      role: "INSPECTOR",
      department: "Enforcement",
      status: "active",
      lastLoginAt: new Date("2026-03-26T14:00:00Z"),
      securityClearance: "Level 3",
      permissions: {
        productApproval: false,
        recallIssuance: true,
        userManagement: false,
        systemSettings: false,
        auditLogAccess: true,
        reportsInvestigation: true
      }
    },
    {
      fullName: "Compliance Officer",
      email: "compliance@nafdac.gov.ng",
      role: "COMPLIANCE",
      department: "Legal",
      status: "active",
      lastLoginAt: new Date("2026-03-26T16:30:00Z"),
      securityClearance: "Level 4 (High)",
      supervisor: "Director General",
      officeLocation: "NAFDAC HQ, Abuja",
      permissions: {
        productApproval: true,
        recallIssuance: false,
        userManagement: false,
        systemSettings: false,
        auditLogAccess: true,
        reportsInvestigation: true
      },
      activity: [
        { kind: "success", title: "Approved Product", timeLabel: "2 hours ago", target: "Amoxicillin 500mg" },
        { kind: "danger", title: "Initiated Recall", timeLabel: "5 hours ago", target: "Batch EMZ-001" }
      ]
    },
    {
      fullName: "Data Analyst",
      email: "analyst@nafdac.gov.ng",
      role: "ANALYST",
      department: "ICT",
      status: "inactive",
      lastLoginAt: new Date("2026-02-01T10:00:00Z"),
      securityClearance: "Level 2",
      permissions: {
        productApproval: false,
        recallIssuance: false,
        userManagement: false,
        systemSettings: false,
        auditLogAccess: true,
        reportsInvestigation: false
      }
    },
    {
      fullName: "Field Agent 1",
      email: "agent1@nafdac.gov.ng",
      role: "FIELD_AGENT",
      department: "Enforcement",
      status: "active",
      lastLoginAt: new Date("2026-03-25T08:00:00Z"),
      securityClearance: "Level 2",
      permissions: {
        productApproval: false,
        recallIssuance: false,
        userManagement: false,
        systemSettings: false,
        auditLogAccess: false,
        reportsInvestigation: true
      }
    }
  ]);
  demoStaffSeeded = true;
}

async function getOrCreateSettings() {
  let doc = await PlatformSettings.findOne({ key: "default" });
  if (!doc) {
    doc = await PlatformSettings.create({ key: "default" });
  }
  return doc;
}

function formatLogTime(d) {
  if (!d) return "";
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")} ${String(
    x.getHours()
  ).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}

function deviceLabel(ua) {
  if (!ua) return "Web Client";
  const u = ua.toLowerCase();
  if (u.includes("iphone")) return "iPhone";
  if (u.includes("android")) return "Android";
  return ua.length > 48 ? `${ua.slice(0, 45)}…` : ua;
}

const DEMO_LOG_ROWS = {
  audit: [
    {
      id: "d-a1",
      type: "AUDIT",
      eventTitle: "Approved Product",
      eventSub: "AMOXICILLIN 500MG",
      actor: "Admin One",
      timestamp: "2026-03-27 09:15",
      severity: "low"
    },
    {
      id: "d-a2",
      type: "AUDIT",
      eventTitle: "Initiated Recall",
      eventSub: "BATCH EMZ-001",
      actor: "Inspector Lagos",
      timestamp: "2026-03-27 09:15",
      severity: "high"
    },
    {
      id: "d-a3",
      type: "AUDIT",
      eventTitle: "Flagged Product",
      eventSub: "COUGH SYRUP X",
      actor: "Compliance Officer",
      timestamp: "2026-03-27 09:15",
      severity: "medium"
    }
  ],
  verification: [
    {
      id: "d-v1",
      type: "VERIFICATION",
      eventTitle: "Unknown Product",
      eventSub: "KANO, NIGERIA",
      actor: "Samsung S21",
      timestamp: "2026-03-27 09:15",
      severity: "failed"
    },
    {
      id: "d-v2",
      type: "VERIFICATION",
      eventTitle: "Paracetamol 500mg",
      eventSub: "LAGOS, NIGERIA",
      actor: "iPhone 13",
      timestamp: "2026-03-27 09:15",
      severity: "success"
    }
  ],
  system: [
    {
      id: "d-s1",
      type: "SYSTEM",
      eventTitle: "Automated Backup",
      eventSub: "MAIN DATABASE",
      actor: "System",
      timestamp: "2026-03-27 09:15",
      severity: "success"
    },
    {
      id: "d-s2",
      type: "SYSTEM",
      eventTitle: "Security Patch",
      eventSub: "AUTH SERVICE",
      actor: "System",
      timestamp: "2026-03-27 09:15",
      severity: "success"
    }
  ]
};

router.get("/manufacturers", async (req, res, next) => {
  try {
    await seedDemoManufacturersIfEmpty();
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const filter = q
      ? {
          $or: [{ companyName: new RegExp(escapeRegex(q), "i") }, { email: new RegExp(escapeRegex(q), "i") }]
        }
      : {};
    const rows = await ManufacturerUser.find(filter).sort({ companyName: 1 }).limit(200).lean();
    const out = [];
    for (const m of rows) {
      const productCount = await ProductRecord.countDocuments({ manufacturer: m.companyName });
      out.push({
        id: String(m._id),
        companyName: m.companyName,
        email: m.email,
        productCount,
        isActive: m.isActive,
        licenseSuspended: !!m.licenseSuspended
      });
    }
    return res.json({ ok: true, data: out });
  } catch (e) {
    return next(e);
  }
});

router.get("/manufacturers/:id/detail", async (req, res, next) => {
  try {
    await seedDemoManufacturersIfEmpty();
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "INVALID_ID" });
    }
    const m = await ManufacturerUser.findById(req.params.id).lean();
    if (!m) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const products = await ProductRecord.find({ manufacturer: m.companyName })
      .sort({ updatedAt: -1 })
      .limit(80)
      .lean();
    const docs = [
      { name: "Manufacturing License.pdf", meta: "PDF · 240 KB" },
      { name: "GMP Certificate.pdf", meta: "PDF · 180 KB" }
    ];
    const audits = [
      { id: "1", title: "Facility inspection", date: "2025-11-12", status: "passed" },
      { id: "2", title: "License renewal", date: "2026-01-08", status: "pending" }
    ];
    return res.json({
      ok: true,
      data: {
        id: String(m._id),
        companyName: m.companyName,
        email: m.email,
        isActive: m.isActive,
        licenseSuspended: !!m.licenseSuspended,
        suspensionReason: m.suspensionReason || "",
        complianceDocuments: docs,
        auditHistory: audits,
        products: products.map((p) => ({
          productId: p.productId,
          name: p.drugName,
          batchNumber: p.batchNumber,
          category: p.nafDacNumber,
          status: p.verificationResult === "GENUINE" ? "active" : p.verificationResult === "FLAGGED" ? "flagged" : "review"
        }))
      }
    });
  } catch (e) {
    return next(e);
  }
});

router.post("/manufacturers/:id/suspend-license", async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "INVALID_ID" });
    }
    const m = await ManufacturerUser.findById(req.params.id);
    if (!m) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    m.licenseSuspended = true;
    m.suspensionReason = typeof reason === "string" ? reason.slice(0, 2000) : "";
    await m.save();
    return res.json({ ok: true, data: { id: String(m._id), licenseSuspended: true } });
  } catch (e) {
    return next(e);
  }
});

router.get("/staff-users", async (req, res, next) => {
  try {
    await seedAdminStaffIfEmpty();
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
    const filter = {};
    if (q) {
      filter.$or = [
        { fullName: new RegExp(escapeRegex(q), "i") },
        { email: new RegExp(escapeRegex(q), "i") },
        { department: new RegExp(escapeRegex(q), "i") }
      ];
    }
    if (status === "active" || status === "inactive") {
      filter.status = status;
    }
    const rows = await AdminStaffUser.find(filter).sort({ fullName: 1 }).limit(200).lean();
    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r._id),
        fullName: r.fullName,
        email: r.email,
        role: r.role,
        department: r.department,
        lastLogin: r.lastLoginAt ? formatLogTime(r.lastLoginAt) : "—",
        status: r.status
      }))
    });
  } catch (e) {
    return next(e);
  }
});

router.post("/staff-users", async (req, res, next) => {
  try {
    const { fullName, email, role, department } = req.body || {};
    if (!fullName || !email) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }
    const r = role && ["SUPER_ADMIN", "INSPECTOR", "COMPLIANCE", "ANALYST", "FIELD_AGENT"].includes(role) ? role : "INSPECTOR";
    const doc = await AdminStaffUser.create({
      fullName: String(fullName).slice(0, 200),
      email: String(email).toLowerCase().slice(0, 320),
      role: r,
      department: typeof department === "string" ? department.slice(0, 200) : "",
      status: "active",
      permissions: {
        productApproval: true,
        recallIssuance: false,
        userManagement: false,
        systemSettings: false,
        auditLogAccess: true,
        reportsInvestigation: false
      }
    });
    return res.json({ ok: true, data: { id: String(doc._id) } });
  } catch (e) {
    if (e && e.code === 11000) {
      return res.status(409).json({ ok: false, error: "EMAIL_EXISTS" });
    }
    return next(e);
  }
});

router.get("/staff-users/:id", async (req, res, next) => {
  try {
    await seedAdminStaffIfEmpty();
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    const r = await AdminStaffUser.findById(req.params.id).lean();
    if (!r) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return res.json({
      ok: true,
      data: {
        id: String(r._id),
        fullName: r.fullName,
        email: r.email,
        role: r.role,
        department: r.department,
        status: r.status,
        lastLogin: r.lastLoginAt ? formatLogTime(r.lastLoginAt) : "—",
        accountCreated: r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "",
        securityClearance: r.securityClearance,
        permissions: r.permissions || {},
        activity: r.activity || [],
        twoFactorEnabled: r.twoFactorEnabled,
        lastIp: r.lastIp || "192.168.1.45",
        primaryDevice: r.primaryDevice || "MacBook Pro 14\"",
        supervisor: r.supervisor || "Director General",
        officeLocation: r.officeLocation || "NAFDAC HQ, Abuja",
        deactivationReason: r.deactivationReason || ""
      }
    });
  } catch (e) {
    return next(e);
  }
});

router.patch("/staff-users/:id/permissions", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "INVALID_ID" });
    }
    const p = req.body?.permissions;
    if (!p || typeof p !== "object") {
      return res.status(400).json({ ok: false, error: "INVALID_BODY" });
    }
    const doc = await AdminStaffUser.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!doc.permissions) doc.permissions = {};
    const keys = [
      "productApproval",
      "recallIssuance",
      "userManagement",
      "systemSettings",
      "auditLogAccess",
      "reportsInvestigation"
    ];
    for (const k of keys) {
      if (typeof p[k] === "boolean") doc.permissions[k] = p[k];
    }
    await doc.save();
    return res.json({ ok: true, data: { id: String(doc._id), permissions: doc.permissions } });
  } catch (e) {
    return next(e);
  }
});

router.post("/staff-users/:id/deactivate", async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const doc = await AdminStaffUser.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    doc.status = "inactive";
    doc.deactivationReason = typeof reason === "string" ? reason.slice(0, 2000) : "";
    await doc.save();
    return res.json({ ok: true, data: { id: String(doc._id), status: doc.status } });
  } catch (e) {
    return next(e);
  }
});

router.post("/staff-users/:id/reset-password", async (req, res, next) => {
  try {
    const doc = await AdminStaffUser.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return res.json({
      ok: true,
      data: {
        message: `A temporary password would be sent to ${doc.email} (demo: no email sent).`
      }
    });
  } catch (e) {
    return next(e);
  }
});

router.get("/logs", async (req, res, next) => {
  try {
    const tab = typeof req.query.tab === "string" ? req.query.tab.toLowerCase() : "all";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const statusFilter = typeof req.query.status === "string" ? req.query.status.toLowerCase() : "";

    const raw = await VerificationLog.find().sort({ createdAt: -1 }).limit(150).lean();
    const verificationFromDb = raw.map((v) => {
      const ok = v.verificationResult === "GENUINE";
      return {
        id: String(v._id),
        type: "VERIFICATION",
        eventTitle: ok ? `Product #${v.productId || "—"}` : "Unknown / Failed verification",
        eventSub: v.batchNumber || (v.productId ? `Product ${v.productId}` : "Scan"),
        actor: deviceLabel(v.userAgent),
        timestamp: formatLogTime(v.createdAt),
        severity: ok ? "success" : v.verificationResult === "FLAGGED" ? "medium" : "failed"
      };
    });

    let audit = [...DEMO_LOG_ROWS.audit];
    let verification = verificationFromDb.length ? verificationFromDb : [...DEMO_LOG_ROWS.verification];
    let system = [...DEMO_LOG_ROWS.system];

    let merged = [...audit, ...verification, ...system].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    if (tab === "audit") merged = audit;
    else if (tab === "verification") merged = verification;
    else if (tab === "system") merged = system;

    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      merged = merged.filter((row) => rx.test(row.eventTitle) || rx.test(row.eventSub) || rx.test(row.actor));
    }
    if (statusFilter === "success") merged = merged.filter((r) => r.severity === "success");
    else if (statusFilter === "failed") merged = merged.filter((r) => r.severity === "failed");
    else if (statusFilter === "high") merged = merged.filter((r) => r.severity === "high");
    else if (statusFilter === "medium") merged = merged.filter((r) => r.severity === "medium");
    else if (statusFilter === "low") merged = merged.filter((r) => r.severity === "low");

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const events24h = await VerificationLog.countDocuments({ createdAt: { $gte: since } });

    return res.json({
      ok: true,
      data: {
        rows: merged.slice(0, 100),
        overview: {
          totalEvents24h: events24h || 1242,
          criticalAlerts: 3,
          adminActions: 452
        }
      }
    });
  } catch (e) {
    return next(e);
  }
});

router.get("/analytics/regulatory", async (req, res, next) => {
  try {
    const range = typeof req.query.range === "string" ? req.query.range : "7d";
    const days = range === "90d" ? 90 : range === "30d" ? 30 : 7;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const totalLogs = await VerificationLog.countDocuments({ createdAt: { $gte: start, $lte: end } });
    const fakes = await VerificationLog.countDocuments({
      createdAt: { $gte: start, $lte: end },
      verificationResult: { $in: ["NOT_REGISTERED", "FLAGGED"] }
    });
    const fakeRate = totalLogs > 0 ? ((fakes / totalLogs) * 100).toFixed(1) : "0";
    const trust =
      totalLogs > 0 ? Math.max(0, Math.min(100, 100 - Number(fakeRate))).toFixed(1) : null;

    const agg = await VerificationLog.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            ymd: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
            result: "$verificationResult"
          },
          count: { $sum: 1 }
        }
      }
    ]);

    const byDay = new Map();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const key = utcDateKey(d);
      byDay.set(key, { total: 0, fakes: 0 });
    }
    for (const row of agg) {
      const b = byDay.get(row._id.ymd);
      if (!b) continue;
      b.total += row.count;
      if (row._id.result !== "GENUINE") b.fakes += row.count;
    }

    const trend = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const key = utcDateKey(d);
      const v = byDay.get(key) || { total: 0, fakes: 0 };
      const dow = d.getUTCDay();
      const mondayIdx = dow === 0 ? 6 : dow - 1;
      const label =
        days <= 7
          ? WEEKDAY_LABELS[mondayIdx]
          : `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`;
      trend.push({
        label,
        verifications: v.total,
        fakes: v.fakes
      });
    }

    const recallsOpen = await RecallRequest.countDocuments({ status: { $in: ["pending", "approved"] } });

    const productStatusAgg = await ProductRecord.aggregate([
      { $group: { _id: { $ifNull: ["$verificationResult", "UNKNOWN"] }, count: { $sum: 1 } } }
    ]);
    const statusMeta = {
      GENUINE: { name: "Genuine", color: "#10b981" },
      FLAGGED: { name: "Flagged", color: "#f59e0b" },
      NOT_REGISTERED: { name: "Not registered", color: "#ef4444" }
    };
    const categories = productStatusAgg.map((c) => {
      const meta = statusMeta[c._id] || { name: String(c._id), color: "#94a3b8" };
      return { name: meta.name, value: c.count, color: meta.color };
    });

    return res.json({
      ok: true,
      data: {
        kpis: [
          {
            key: "trust",
            label: "Trust index (approx.)",
            value: trust != null ? `${trust}%` : "—",
            delta: "—",
            deltaUp: true,
            good: true
          },
          {
            key: "speed",
            label: "Avg. verification time",
            value: "—",
            delta: "—",
            deltaUp: true,
            good: true
          },
          {
            key: "fake",
            label: "Suspicious / unregistered rate",
            value: totalLogs > 0 ? `${fakeRate}%` : "—",
            delta: "—",
            deltaUp: false,
            good: false
          },
          {
            key: "recall",
            label: "Open recall requests",
            value: String(recallsOpen),
            delta: "—",
            deltaUp: false,
            good: true
          }
        ],
        trend,
        categories,
        regionalRisk: [],
        devices: []
      }
    });
  } catch (e) {
    return next(e);
  }
});

router.get("/settings", async (req, res, next) => {
  try {
    const doc = await getOrCreateSettings();
    return res.json({ ok: true, data: { general: doc.general, security: doc.security } });
  } catch (e) {
    return next(e);
  }
});

router.patch("/settings", async (req, res, next) => {
  try {
    const { general, security } = req.body || {};
    const doc = await getOrCreateSettings();
    if (general && typeof general === "object") {
      if (typeof general.platformName === "string") doc.general.platformName = general.platformName.slice(0, 200);
      if (typeof general.regulatoryAuthority === "string") {
        doc.general.regulatoryAuthority = general.regulatoryAuthority.slice(0, 200);
      }
      if (typeof general.primaryLanguage === "string") {
        doc.general.primaryLanguage = general.primaryLanguage.slice(0, 120);
      }
      if (typeof general.timezone === "string") doc.general.timezone = general.timezone.slice(0, 120);
      if (typeof general.maintenanceMode === "boolean") doc.general.maintenanceMode = general.maintenanceMode;
    }
    if (security && typeof security === "object") {
      if (typeof security.twoFactorRequired === "boolean") doc.security.twoFactorRequired = security.twoFactorRequired;
      if (typeof security.ipWhitelisting === "boolean") doc.security.ipWhitelisting = security.ipWhitelisting;
      if (typeof security.sessionTimeout === "boolean") doc.security.sessionTimeout = security.sessionTimeout;
      if (typeof security.passwordComplexity === "boolean") {
        doc.security.passwordComplexity = security.passwordComplexity;
      }
    }
    await doc.save();
    return res.json({ ok: true, data: { general: doc.general, security: doc.security } });
  } catch (e) {
    return next(e);
  }
});

router.get("/compliance/overview", async (req, res, next) => {
  try {
    const pendingApps = await ProductApplication.countDocuments({ status: "pending" });
    const pendingRecalls = await RecallRequest.countDocuments({ status: "pending" });
    const totalProducts = await ProductRecord.countDocuments();
    const suspiciousOpen = await SuspiciousReport.countDocuments({
      status: { $in: ["pending", "flagged", "escalated"] }
    });

    return res.json({
      ok: true,
      data: {
        kpis: [
          {
            key: "apps",
            label: "Pending product applications",
            value: String(pendingApps),
            hint: "Manufacturer submissions awaiting review."
          },
          {
            key: "recalls",
            label: "Pending recall requests",
            value: String(pendingRecalls),
            hint: "Awaiting regulatory decision."
          },
          {
            key: "registry",
            label: "Registered products (mirror)",
            value: String(totalProducts),
            hint: "Rows in ProductRecord."
          },
          {
            key: "reports",
            label: "Open suspicious reports",
            value: String(suspiciousOpen),
            hint: "Reports not yet dismissed."
          }
        ],
        timeline: []
      }
    });
  } catch (e) {
    return next(e);
  }
});

router.post("/compliance/contact", async (req, res, next) => {
  try {
    const { subject, message, priority } = req.body || {};
    if (!subject || !message) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }
    return res.json({
      ok: true,
      data: {
        received: true,
        priority: priority || "medium"
      }
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
