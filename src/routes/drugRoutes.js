const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { ZeroAddress, getAddress, isAddress } = require("ethers");
const { requireAdmin, requireManufacturer } = require("../middleware/auth");
const { getReadContract, getWriteContract } = require("../lib/blockchainClient");
const { generateVerificationQrDataUrl } = require("../services/qrService");
const ProductRecord = require("../models/ProductRecord");
const VerificationLog = require("../models/VerificationLog");
const AdminUser = require("../models/AdminUser");
const ManufacturerUser = require("../models/ManufacturerUser");
const ProductApplication = require("../models/ProductApplication");

const router = express.Router();

function jwtAccessSecret() {
  return process.env.JWT_SECRET || null;
}

/** Defaults to JWT_SECRET; set JWT_REFRESH_SECRET to sign refresh tokens with a separate key. */
function jwtRefreshSecret() {
  return process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || null;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function relTimeLabel(d) {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "JUST NOW";
  if (m < 60) return `${m} MIN${m === 1 ? "" : "S"} AGO`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} HOUR${h === 1 ? "" : "S"} AGO`;
  const days = Math.floor(h / 24);
  return `${days} DAY${days === 1 ? "" : "S"} AGO`;
}

async function mapRecentLogsToActivity(logs) {
  const ids = [...new Set(logs.map((l) => l.productId).filter((id) => id != null))];
  const products =
    ids.length === 0
      ? []
      : await ProductRecord.find({ productId: { $in: ids } }).select("productId drugName").lean();
  const byId = new Map(products.map((p) => [p.productId, p]));

  return logs.map((log) => {
    const prod = log.productId != null ? byId.get(log.productId) : null;
    const drug = prod?.drugName || "Product";
    let kind = "info";
    let title = "Verification";
    let meta =
      log.batchNumber ||
      (log.productId != null ? `Product #${log.productId}` : "—");

    if (log.verificationResult === "GENUINE") {
      kind = "ok";
      title = "Successful Verification";
      meta = prod
        ? `${drug}${log.batchNumber ? ` · Batch ${log.batchNumber}` : ""}`
        : meta;
    } else if (log.verificationResult === "FLAGGED") {
      kind = "flag";
      title = "Suspicious Attempt";
      meta = log.clientIp ? `IP: ${log.clientIp}` : meta;
    } else {
      kind = "warn";
      title = "Unregistered Lookup";
      meta = log.batchNumber || meta;
    }

    return {
      kind,
      title,
      meta,
      timeLabel: relTimeLabel(log.createdAt)
    };
  });
}

function mapStatus(statusNumber) {
  const n = Number(statusNumber);
  if (n === 1) return "GENUINE";
  if (n === 2 || n === 3) return "FLAGGED";
  return "NOT_REGISTERED";
}

async function logVerification({
  queryType,
  productId = null,
  batchNumber = "",
  verificationResult,
  req
}) {
  await VerificationLog.create({
    queryType,
    productId,
    batchNumber,
    verificationResult,
    clientIp: req.ip || "",
    userAgent: req.get("user-agent") || ""
  });
}

router.post("/register-drug", requireAdmin, async (req, res, next) => {
  try {
    const {
      drugName,
      manufacturer,
      nafDacNumber,
      batchNumber,
      ipfsCid = "",
      manufacturerWallet: manufacturerWalletRaw = ""
    } = req.body || {};

    if (!drugName || !manufacturer || !nafDacNumber || !batchNumber) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message:
          "drugName, manufacturer, nafDacNumber, and batchNumber are required"
      });
    }

    let manufacturerWallet = ZeroAddress;
    if (manufacturerWalletRaw) {
      if (!isAddress(manufacturerWalletRaw)) {
        return res.status(400).json({
          ok: false,
          error: "VALIDATION_ERROR",
          message: "manufacturerWallet must be a valid Ethereum address"
        });
      }
      manufacturerWallet = getAddress(manufacturerWalletRaw);
    }

    const contract = getWriteContract();
    const tx = await contract.registerDrug(
      drugName,
      manufacturer,
      nafDacNumber,
      batchNumber,
      ipfsCid,
      manufacturerWallet
    );
    const receipt = await tx.wait();

    let productId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed && parsed.name === "DrugRegistered") {
          productId = Number(parsed.args.productId);
          break;
        }
      } catch (_e) {
        // Non-registry logs are ignored.
      }
    }

    if (!productId) {
      throw new Error("Could not parse productId from transaction logs");
    }

    const qr = await generateVerificationQrDataUrl(productId);

    const chainStatus = await contract.verifyDrug(productId);
    const chainDrug = await contract.getDrug(productId);

    await ProductRecord.findOneAndUpdate(
      { productId },
      {
        productId,
        drugName: chainDrug[1],
        manufacturer: chainDrug[2],
        nafDacNumber: chainDrug[3],
        batchNumber: chainDrug[4],
        ipfsCid: chainDrug[5],
        chainCreatedAt: Number(chainDrug[6]),
        statusNumber: Number(chainStatus),
        verificationResult: mapStatus(chainStatus),
        duplicateCount: Number(chainDrug[8]),
        lastTransactionHash: receipt.hash,
        manufacturerWallet:
          manufacturerWallet === ZeroAddress ? "" : manufacturerWallet
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({
      ok: true,
      data: {
        productId,
        transactionHash: receipt.hash,
        verifyUrl: qr.verifyUrl,
        qrCodeDataUrl: qr.qrCodeDataUrl
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/verify-drug/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "Invalid product id"
      });
    }

    const contract = getReadContract();
    const status = await contract.verifyDrug(id);
    const drug = await contract.getDrug(id);

    const exists = Boolean(drug[9]);
    if (!exists) {
      await logVerification({
        queryType: "productId",
        productId: id,
        verificationResult: "NOT_REGISTERED",
        req
      });
      return res.status(404).json({
        ok: true,
        data: {
          productId: id,
          verificationResult: "NOT_REGISTERED"
        }
      });
    }

    await ProductRecord.findOneAndUpdate(
      { productId: Number(drug[0]) },
      {
        productId: Number(drug[0]),
        drugName: drug[1],
        manufacturer: drug[2],
        nafDacNumber: drug[3],
        batchNumber: drug[4],
        ipfsCid: drug[5],
        chainCreatedAt: Number(drug[6]),
        statusNumber: Number(status),
        verificationResult: mapStatus(status),
        duplicateCount: Number(drug[8])
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await logVerification({
      queryType: "productId",
      productId: Number(drug[0]),
      verificationResult: mapStatus(status),
      req
    });

    return res.json({
      ok: true,
      data: {
        productId: Number(drug[0]),
        drugName: drug[1],
        manufacturer: drug[2],
        nafDacNumber: drug[3],
        batchNumber: drug[4],
        ipfsCid: drug[5],
        createdAt: Number(drug[6]),
        statusNumber: Number(status),
        verificationResult: mapStatus(status),
        duplicateCount: Number(drug[8])
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/verify-drug/batch/:batchNumber", async (req, res, next) => {
  try {
    const { batchNumber } = req.params;
    if (!batchNumber) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "Batch number is required"
      });
    }

    const contract = getReadContract();
    const [productId, status] = await contract.verifyByBatch(batchNumber);

    if (Number(productId) === 0) {
      await logVerification({
        queryType: "batchNumber",
        batchNumber,
        verificationResult: "NOT_REGISTERED",
        req
      });
      return res.status(404).json({
        ok: true,
        data: {
          batchNumber,
          verificationResult: "NOT_REGISTERED"
        }
      });
    }

    const drug = await contract.getDrug(productId);
    await ProductRecord.findOneAndUpdate(
      { productId: Number(productId) },
      {
        productId: Number(productId),
        drugName: drug[1],
        manufacturer: drug[2],
        nafDacNumber: drug[3],
        batchNumber: drug[4],
        ipfsCid: drug[5],
        chainCreatedAt: Number(drug[6]),
        statusNumber: Number(status),
        verificationResult: mapStatus(status),
        duplicateCount: Number(drug[8])
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await logVerification({
      queryType: "batchNumber",
      batchNumber,
      productId: Number(productId),
      verificationResult: mapStatus(status),
      req
    });

    return res.json({
      ok: true,
      data: {
        productId: Number(productId),
        batchNumber,
        drugName: drug[1],
        manufacturer: drug[2],
        nafDacNumber: drug[3],
        statusNumber: Number(status),
        verificationResult: mapStatus(status)
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/recall-drug", requireAdmin, async (req, res, next) => {
  try {
    const { productId, recallNote = "" } = req.body || {};

    if (!Number.isFinite(Number(productId)) || Number(productId) <= 0) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "Valid productId is required"
      });
    }

    const contract = getWriteContract();
    const tx = await contract.recallDrug(Number(productId), recallNote);
    const receipt = await tx.wait();
    const updatedStatus = await contract.verifyDrug(Number(productId));
    const updatedDrug = await contract.getDrug(Number(productId));

    await ProductRecord.findOneAndUpdate(
      { productId: Number(productId) },
      {
        productId: Number(updatedDrug[0]),
        drugName: updatedDrug[1],
        manufacturer: updatedDrug[2],
        nafDacNumber: updatedDrug[3],
        batchNumber: updatedDrug[4],
        ipfsCid: updatedDrug[5],
        chainCreatedAt: Number(updatedDrug[6]),
        statusNumber: Number(updatedStatus),
        verificationResult: mapStatus(updatedStatus),
        duplicateCount: Number(updatedDrug[8]),
        lastTransactionHash: receipt.hash
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({
      ok: true,
      data: {
        productId: Number(productId),
        transactionHash: receipt.hash,
        message: "Product recalled successfully"
      }
    });
  } catch (error) {
    if (
      error &&
      typeof error.message === "string" &&
      error.message.includes("missing revert data")
    ) {
      return res.status(400).json({
        ok: false,
        error: "BLOCKCHAIN_REVERT",
        message:
          "Transaction reverted. Ensure product exists and signer has permission."
      });
    }
    return next(error);
  }
});

router.post("/auth/register-admin", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 8) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "email and password (>=8 chars) are required"
      });
    }

    const existing = await AdminUser.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "CONFLICT",
        message: "Admin user already exists"
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await AdminUser.create({
      email: email.toLowerCase(),
      passwordHash,
      role: "admin"
    });

    return res.status(201).json({
      ok: true,
      message: "Admin registered"
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "email and password are required"
      });
    }

    const user = await AdminUser.findOne({
      email: email.toLowerCase(),
      isActive: true
    });
    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "INVALID_CREDENTIALS",
        message: "Invalid email or password"
      });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({
        ok: false,
        error: "INVALID_CREDENTIALS",
        message: "Invalid email or password"
      });
    }

    const accessSecret = jwtAccessSecret();
    const refreshSec = jwtRefreshSecret();
    if (!accessSecret || !refreshSec) {
      return res.status(500).json({
        ok: false,
        error: "CONFIG_ERROR",
        message: "JWT_SECRET is required"
      });
    }

    const rememberMe = Boolean(req.body?.rememberMe);
    const refreshExpiresIn = rememberMe ? "30d" : "7d";

    const accessToken = jwt.sign(
      { type: "access", role: user.role, email: user.email, sub: String(user._id) },
      accessSecret,
      { expiresIn: "15m" }
    );
    const refreshToken = jwt.sign(
      { type: "refresh", role: "admin", email: user.email, sub: String(user._id) },
      refreshSec,
      { expiresIn: refreshExpiresIn }
    );

    return res.json({
      ok: true,
      data: {
        token: accessToken,
        accessToken,
        refreshToken,
        email: user.email
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/refresh", async (req, res, next) => {
  try {
    const { refreshToken, rememberMe } = req.body || {};
    if (!refreshToken || typeof refreshToken !== "string") {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "refreshToken is required"
      });
    }

    const refreshSec = jwtRefreshSecret();
    if (!refreshSec) {
      return res.status(500).json({
        ok: false,
        error: "CONFIG_ERROR",
        message: "JWT_SECRET is required"
      });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, refreshSec);
    } catch (e) {
      return res.status(401).json({
        ok: false,
        error: "INVALID_REFRESH",
        message: "Invalid or expired refresh token"
      });
    }

    if (!payload || payload.type !== "refresh" || payload.role !== "admin") {
      return res.status(401).json({
        ok: false,
        error: "INVALID_REFRESH",
        message: "Invalid refresh token"
      });
    }

    const dbUser = await AdminUser.findOne({
      _id: payload.sub,
      isActive: true
    });
    if (!dbUser) {
      return res.status(401).json({
        ok: false,
        error: "INVALID_REFRESH",
        message: "User not found or inactive"
      });
    }

    const accessSecret = jwtAccessSecret();
    if (!accessSecret) {
      return res.status(500).json({
        ok: false,
        error: "CONFIG_ERROR",
        message: "JWT_SECRET is required"
      });
    }

    const accessToken = jwt.sign(
      { type: "access", role: dbUser.role, email: dbUser.email, sub: String(dbUser._id) },
      accessSecret,
      { expiresIn: "15m" }
    );
    const slidingRemember = Boolean(rememberMe);
    const newRefreshExpires = slidingRemember ? "30d" : "7d";
    const newRefreshToken = jwt.sign(
      { type: "refresh", role: "admin", email: dbUser.email, sub: String(dbUser._id) },
      refreshSec,
      { expiresIn: newRefreshExpires }
    );

    return res.json({
      ok: true,
      data: {
        token: accessToken,
        accessToken,
        refreshToken: newRefreshToken,
        email: dbUser.email
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/mock-admin-token", (req, res) => {
  if (process.env.ALLOW_MOCK_ADMIN_TOKEN !== "true") {
    return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Not found" });
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({
      ok: false,
      error: "CONFIG_ERROR",
      message: "JWT_SECRET is required"
    });
  }

  const accessToken = jwt.sign(
    { type: "access", role: "admin", email: "admin@medichain.ng" },
    secret,
    { expiresIn: "15m" }
  );
  const refreshSec = jwtRefreshSecret() || secret;
  const refreshToken = jwt.sign(
    { type: "refresh", role: "admin", email: "admin@medichain.ng", sub: "mock" },
    refreshSec,
    { expiresIn: "7d" }
  );

  return res.json({
    ok: true,
    data: {
      token: accessToken,
      accessToken,
      refreshToken
    }
  });
});

/**
 * Manufacturer dashboard analytics: weekly verification series (UTC Mon–Sun)
 * and recent verification log rows. Optional ?manufacturer=Name (case-insensitive exact match on ProductRecord.manufacturer).
 */
router.get("/analytics/dashboard", async (req, res, next) => {
  try {
    const manufacturer =
      typeof req.query.manufacturer === "string" ? req.query.manufacturer.trim() : "";

    let productIdFilter = null;
    if (manufacturer) {
      const rows = await ProductRecord.find({
        manufacturer: new RegExp(`^${escapeRegex(manufacturer)}$`, "i")
      })
        .select("productId")
        .lean();
      productIdFilter = rows.map((r) => r.productId);
    }

    const baseMatch = {};
    if (productIdFilter !== null) {
      if (productIdFilter.length === 0) {
        return res.json({
          ok: true,
          data: {
            verificationWeek: WEEKDAY_LABELS.map((label) => ({ label, checks: 0, fake: 0 })),
            recentActivity: []
          }
        });
      }
      baseMatch.productId = { $in: productIdFilter };
    }

    const weekStart = startOfUtcWeekMonday();
    const weekEnd = addDaysUtc(weekStart, 7);

    const byDay = new Map();
    for (let i = 0; i < 7; i += 1) {
      const key = utcDateKey(addDaysUtc(weekStart, i));
      byDay.set(key, { checks: 0, fake: 0 });
    }

    const agg = await VerificationLog.aggregate([
      {
        $match: {
          ...baseMatch,
          createdAt: { $gte: weekStart, $lt: weekEnd }
        }
      },
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
      const key = row._id.ymd;
      const bucket = byDay.get(key);
      if (!bucket) continue;
      const c = row.count;
      const r = row._id.result;
      if (r === "GENUINE") bucket.checks += c;
      if (r === "FLAGGED" || r === "NOT_REGISTERED") bucket.fake += c;
    }

    const verificationWeek = [];
    for (let i = 0; i < 7; i += 1) {
      const key = utcDateKey(addDaysUtc(weekStart, i));
      const b = byDay.get(key) || { checks: 0, fake: 0 };
      verificationWeek.push({ label: WEEKDAY_LABELS[i], checks: b.checks, fake: b.fake });
    }

    const recentLogs = await VerificationLog.find(baseMatch)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const recentActivity = await mapRecentLogsToActivity(recentLogs);

    return res.json({
      ok: true,
      data: {
        verificationWeek,
        recentActivity
      }
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Public product registry (Mongo mirror of on-chain products).
 */
router.get("/registry/products", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
    const filter = {};
    if (q) {
      filter.$or = [
        { drugName: new RegExp(escapeRegex(q), "i") },
        { manufacturer: new RegExp(escapeRegex(q), "i") },
        { nafDacNumber: new RegExp(escapeRegex(q), "i") },
        { batchNumber: new RegExp(escapeRegex(q), "i") }
      ];
    }
    const rows = await ProductRecord.find(filter).sort({ updatedAt: -1 }).limit(limit).lean();
    return res.json({
      ok: true,
      data: rows.map((r) => ({
        productId: r.productId,
        drugName: r.drugName,
        manufacturer: r.manufacturer,
        nafdacNumber: r.nafDacNumber,
        batchNumber: r.batchNumber,
        verificationResult: r.verificationResult,
        ipfsCid: r.ipfsCid || ""
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/registry/manufacturers", async (req, res, next) => {
  try {
    const agg = await ProductRecord.aggregate([
      { $match: { manufacturer: { $nin: [null, ""] } } },
      { $group: { _id: "$manufacturer", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 100 }
    ]);
    const slugify = (name) =>
      String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "manufacturer";
    return res.json({
      ok: true,
      data: agg.map((a) => ({
        slug: slugify(a._id),
        name: a._id,
        productCount: a.count
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/manufacturer/register", async (req, res, next) => {
  try {
    const { email, password, companyName } = req.body || {};
    if (!email || !password || password.length < 8 || !companyName) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "email, password (>= 8 chars), and companyName are required"
      });
    }

    const existing = await ManufacturerUser.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "CONFLICT",
        message: "Email already registered"
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await ManufacturerUser.create({
      email: email.toLowerCase(),
      passwordHash,
      companyName: String(companyName).trim()
    });

    return res.status(201).json({ ok: true, message: "Manufacturer registered" });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/manufacturer/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "email and password are required"
      });
    }

    const user = await ManufacturerUser.findOne({ email: email.toLowerCase() });
    if (!user || !user.isActive) {
      return res.status(401).json({
        ok: false,
        error: "INVALID_CREDENTIALS",
        message: "Invalid email or password"
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({
        ok: false,
        error: "INVALID_CREDENTIALS",
        message: "Invalid email or password"
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({
        ok: false,
        error: "CONFIG_ERROR",
        message: "JWT_SECRET is required"
      });
    }

    const token = jwt.sign(
      {
        role: "manufacturer",
        email: user.email,
        sub: String(user._id),
        companyName: user.companyName
      },
      secret,
      { expiresIn: "7d" }
    );

    return res.json({
      ok: true,
      data: {
        token,
        companyName: user.companyName,
        email: user.email
      }
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Manufacturer: submit a product approval application (metadata + document URLs from IPFS / Cloudinary uploads).
 */
router.post("/manufacturer/product-applications", requireManufacturer, async (req, res, next) => {
  try {
    const sub = req.user && req.user.sub;
    if (!sub || !mongoose.Types.ObjectId.isValid(sub)) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_SESSION",
        message: "Invalid manufacturer session"
      });
    }

    const body = req.body || {};
    const {
      productName,
      category = "",
      productType = "MEDICINE",
      description = "",
      nafdacNumber = "",
      approvalDate,
      expiryDate,
      location = "",
      manufacturerName,
      thumbnailUrl = "",
      documents = []
    } = body;

    if (!productName || typeof productName !== "string") {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "productName is required"
      });
    }

    if (!Array.isArray(documents)) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "documents must be an array"
      });
    }

    const user = await ManufacturerUser.findById(sub).select("companyName email").lean();
    const company = user?.companyName || "";

    const normalizedDocs = documents.map((d) => ({
      name: String(d.name || "Document"),
      fileName: String(d.fileName || ""),
      status: "pending",
      mimeType: String(d.mimeType || "application/octet-stream"),
      previewUrl: String(d.previewUrl || "")
    }));

    const now = new Date();
    const timeline = [
      {
        key: "submitted",
        title: "Application submitted",
        subtitle: "Awaiting regulatory review",
        at: now,
        tone: "blue"
      }
    ];

    const checklist = [
      { id: "submitted", label: "Application received", done: true },
      { id: "review", label: "Regulatory review", done: false },
      { id: "decision", label: "Decision", done: false }
    ];

    const doc = await ProductApplication.create({
      manufacturerId: sub,
      productName: String(productName).trim(),
      category: String(category).trim(),
      productType: String(productType).trim() || "MEDICINE",
      description: String(description).trim(),
      nafdacNumber: String(nafdacNumber).trim(),
      approvalDate: approvalDate ? new Date(approvalDate) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      location: String(location).trim(),
      manufacturerName: String(manufacturerName || company).trim(),
      contactEmail: user?.email || "",
      thumbnailUrl: String(thumbnailUrl).trim(),
      documents: normalizedDocs,
      timeline,
      checklist,
      status: "pending",
      registrationLabel: "NEW APPLICATION"
    });

    return res.status(201).json({
      ok: true,
      data: {
        id: String(doc._id),
        status: doc.status,
        createdAt: doc.createdAt
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/manufacturer/product-applications", requireManufacturer, async (req, res, next) => {
  try {
    const sub = req.user && req.user.sub;
    if (!sub || !mongoose.Types.ObjectId.isValid(sub)) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_SESSION",
        message: "Invalid manufacturer session"
      });
    }

    const rows = await ProductApplication.find({ manufacturerId: sub })
      .sort({ createdAt: -1 })
      .limit(100)
      .select(
        "productName category status nafdacNumber createdAt updatedAt thumbnailUrl productId registrationLabel"
      )
      .lean();

    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r._id),
        productName: r.productName,
        category: r.category,
        status: r.status,
        nafdacNumber: r.nafdacNumber,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        thumbnailUrl: r.thumbnailUrl,
        productId: r.productId,
        registrationLabel: r.registrationLabel
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/manufacturer/me/summary", requireManufacturer, async (req, res, next) => {
  try {
    const sub = req.user && req.user.sub;
    if (!sub || !mongoose.Types.ObjectId.isValid(sub)) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_SESSION",
        message: "Invalid manufacturer session"
      });
    }

    const user = await ManufacturerUser.findById(sub).select("companyName").lean();
    const companyName = user?.companyName || "";

    const apps = await ProductApplication.find({ manufacturerId: sub }).lean();
    const pending = apps.filter((a) => a.status === "pending").length;
    const approved = apps.filter((a) => a.status === "approved").length;
    const rejected = apps.filter((a) => a.status === "rejected").length;
    const changesRequested = apps.filter((a) => a.status === "changes_requested").length;

    return res.json({
      ok: true,
      data: {
        companyName,
        totalApplications: apps.length,
        pending,
        approved,
        rejected,
        changesRequested
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

