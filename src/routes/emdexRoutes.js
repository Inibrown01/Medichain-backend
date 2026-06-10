const express = require("express");
const ProductRecord = require("../models/ProductRecord");
const {
  searchProducts,
  getCatalogStats,
  findByNafdacNumber,
  getProductById,
  apiClient
} = require("../services/emdexService");

const router = express.Router();

router.get("/stats", async (_req, res, next) => {
  try {
    const data = await getCatalogStats();
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get("/products/search", async (req, res, next) => {
  try {
    const { q = "", page = "1", limit = "20" } = req.query;
    const data = await searchProducts({ q, page, limit });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get("/products/nafdac/:nafdacNumber", async (req, res, next) => {
  try {
    const data = await findByNafdacNumber(req.params.nafdacNumber);
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get("/products/:emdexProductId", async (req, res, next) => {
  try {
    const data = await getProductById(req.params.emdexProductId);
    if (!data.found) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "Product not found in EMDEX"
      });
    }
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get("/brands/search", async (req, res, next) => {
  try {
    if (!apiClient.licensedApiEnabled()) {
      return res.status(503).json({
        ok: false,
        error: "EMDEX_NOT_CONFIGURED",
        message: "Set EMDEX_EMAIL and EMDEX_PASSWORD in backend .env to use brand search"
      });
    }
    const { q = "", form = "", strength = "" } = req.query;
    const brands = await apiClient.searchBrands({
      keyword: q,
      form,
      strength
    });
    return res.json({ ok: true, data: { brands, total: brands.length } });
  } catch (error) {
    return next(error);
  }
});

router.get("/brands/:id", async (req, res, next) => {
  try {
    if (!apiClient.licensedApiEnabled()) {
      return res.status(503).json({
        ok: false,
        error: "EMDEX_NOT_CONFIGURED",
        message: "Licensed EMDEX API is not configured"
      });
    }
    const brand = await apiClient.getBrandDetails(req.params.id);
    if (!brand) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "Brand not found"
      });
    }
    return res.json({ ok: true, data: { brand } });
  } catch (error) {
    return next(error);
  }
});

router.get("/generics/search", async (req, res, next) => {
  try {
    if (!apiClient.licensedApiEnabled()) {
      return res.status(503).json({
        ok: false,
        error: "EMDEX_NOT_CONFIGURED",
        message: "Licensed EMDEX API is not configured"
      });
    }
    const { q = "" } = req.query;
    const generics = await apiClient.searchGenerics({ keyword: q });
    return res.json({ ok: true, data: { generics, total: generics.length } });
  } catch (error) {
    return next(error);
  }
});

router.get("/generics/:id", async (req, res, next) => {
  try {
    if (!apiClient.licensedApiEnabled()) {
      return res.status(503).json({
        ok: false,
        error: "EMDEX_NOT_CONFIGURED",
        message: "Licensed EMDEX API is not configured"
      });
    }
    const generic = await apiClient.getGenericDetails(req.params.id);
    if (!generic) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "Generic not found"
      });
    }
    return res.json({ ok: true, data: { generic } });
  } catch (error) {
    return next(error);
  }
});

router.get("/generics/:id/brands", async (req, res, next) => {
  try {
    if (!apiClient.licensedApiEnabled()) {
      return res.status(503).json({
        ok: false,
        error: "EMDEX_NOT_CONFIGURED",
        message: "Licensed EMDEX API is not configured"
      });
    }
    const brands = await apiClient.getGenericBrands(req.params.id);
    return res.json({ ok: true, data: { brands, total: brands.length } });
  } catch (error) {
    return next(error);
  }
});

router.get("/companies/search", async (req, res, next) => {
  try {
    if (!apiClient.licensedApiEnabled()) {
      return res.status(503).json({
        ok: false,
        error: "EMDEX_NOT_CONFIGURED",
        message: "Licensed EMDEX API is not configured"
      });
    }
    const { q = "" } = req.query;
    const companies = await apiClient.searchCompanies({ keyword: q });
    return res.json({ ok: true, data: { companies, total: companies.length } });
  } catch (error) {
    return next(error);
  }
});

router.get("/companies/:id", async (req, res, next) => {
  try {
    if (!apiClient.licensedApiEnabled()) {
      return res.status(503).json({
        ok: false,
        error: "EMDEX_NOT_CONFIGURED",
        message: "Licensed EMDEX API is not configured"
      });
    }
    const company = await apiClient.getCompanyDetails(req.params.id);
    if (!company) {
      return res.status(404).json({
        ok: false,
        error: "NOT_FOUND",
        message: "Company not found"
      });
    }
    return res.json({ ok: true, data: { company } });
  } catch (error) {
    return next(error);
  }
});

router.get("/verify/nafdac/:nafdacNumber", async (req, res, next) => {
  try {
    const nafdacNumber = String(req.params.nafdacNumber || "").trim();
    if (!nafdacNumber) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "NAFDAC number is required"
      });
    }

    const [emdex, medichainRows] = await Promise.all([
      findByNafdacNumber(nafdacNumber),
      ProductRecord.find({ nafDacNumber: nafdacNumber })
        .sort({ productId: -1 })
        .limit(10)
        .lean()
    ]);

    const emdexProduct = emdex.products[0] || null;
    const medichainMatch = medichainRows[0] || null;

    let alignment = "UNKNOWN";
    if (emdex.found && medichainMatch) {
      const nameMatch =
        emdexProduct.productName.toLowerCase() ===
        String(medichainMatch.drugName || "").toLowerCase();
      alignment = nameMatch ? "ALIGNED" : "MISMATCH";
    } else if (emdex.found && !medichainMatch) {
      alignment = "EMDEX_ONLY";
    } else if (!emdex.found && medichainMatch) {
      alignment = "MEDICHAIN_ONLY";
    } else {
      alignment = "NOT_FOUND";
    }

    return res.json({
      ok: true,
      data: {
        nafdacNumber,
        alignment,
        emdex: {
          found: emdex.found,
          product: emdexProduct,
          matchCount: emdex.products.length
        },
        medichain: {
          found: Boolean(medichainMatch),
          records: medichainRows.map((r) => ({
            productId: r.productId,
            drugName: r.drugName,
            manufacturer: r.manufacturer,
            batchNumber: r.batchNumber,
            verificationResult: r.verificationResult,
            statusNumber: r.statusNumber
          }))
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
