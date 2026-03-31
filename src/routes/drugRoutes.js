const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { ZeroAddress, getAddress, isAddress } = require("ethers");
const { requireAdmin } = require("../middleware/auth");
const { getReadContract, getWriteContract } = require("../lib/blockchainClient");
const { generateVerificationQrDataUrl } = require("../services/qrService");
const ProductRecord = require("../models/ProductRecord");
const VerificationLog = require("../models/VerificationLog");
const AdminUser = require("../models/AdminUser");

const router = express.Router();

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

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({
        ok: false,
        error: "CONFIG_ERROR",
        message: "JWT_SECRET is required"
      });
    }

    const token = jwt.sign(
      { role: user.role, email: user.email, sub: String(user._id) },
      secret,
      { expiresIn: "12h" }
    );

    return res.json({
      ok: true,
      data: {
        token
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/mock-admin-token", (req, res) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({
      ok: false,
      error: "CONFIG_ERROR",
      message: "JWT_SECRET is required"
    });
  }

  const token = jwt.sign(
    { role: "admin", email: "admin@medichain.ng" },
    secret,
    { expiresIn: "12h" }
  );

  return res.json({
    ok: true,
    data: {
      token
    }
  });
});

module.exports = router;

