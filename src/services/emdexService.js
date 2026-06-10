/**
 * EMDEX integration: licensed REST API (when configured) + NAFDAC Greenbook fallback.
 * Postman collection: express-backend/EMDEX DB API Doc.postman_collection.json
 */

const apiClient = require("./emdexApiClient");

const GREENBOOK_BASE =
  process.env.EMDEX_GREENBOOK_URL || "https://www.nafdac.emdex.ng";

const CACHE_TTL_MS = Number(process.env.EMDEX_CACHE_TTL_MS || 300_000);
const cache = new Map();

function cacheKey(parts) {
  return parts.join("|");
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function normalizeGreenbookProduct(row) {
  return {
    emdexProductId: row.product_id,
    productName: row.product_name || "",
    nafdacNumber: row.NAFDAC || "",
    activeIngredient:
      row.ingredient?.ingredient_name || row.ingredient_name || "",
    synonym: row.ingredient?.synonym || "",
    category: row.product_category?.name || row.category_name || "",
    dosageForm: row.form?.name || row.form_name || "",
    route: row.route?.name || row.route_name || "",
    strength: row.strength || "",
    applicantName: row.applicant?.name || row.applicant_name || "",
    manufacturerId: row.manufacturer_id ?? null,
    approvalDate: row.approval_date || "",
    expiryDate: row.expiry_date || "",
    status: row.status || "",
    atc: row.atc || "",
    packSize: row.pack_size || "",
    productDescription: row.product_description || "",
    source: "emdex-greenbook"
  };
}

function brandToProduct(brand) {
  return {
    emdexProductId: brand.id,
    productName: brand.name,
    nafdacNumber: brand.nafdacNumber || "",
    activeIngredient: brand.genericName || "",
    category: "Drugs",
    dosageForm: brand.dosageForm || "",
    route: "",
    strength: brand.strength || "",
    applicantName: brand.manufacturer || "",
    manufacturerId: null,
    approvalDate: "",
    expiryDate: "",
    status: brand.status || "Active",
    packSize: brand.packSize || "",
    source: "emdex-api"
  };
}

async function queryGreenbook({ start = 0, length = 20, search = "", nafdacNumber = "" }) {
  const params = new URLSearchParams();
  params.set("draw", "1");
  params.set("start", String(start));
  params.set("length", String(length));
  params.set("search[value]", search.trim());
  params.set("search[regex]", "false");

  if (nafdacNumber.trim()) {
    params.set("columns[5][data]", "NAFDAC");
    params.set("columns[5][name]", "NAFDAC");
    params.set("columns[5][searchable]", "true");
    params.set("columns[5][search][value]", nafdacNumber.trim());
    params.set("columns[5][search][regex]", "false");
  }

  const url = `${GREENBOOK_BASE}/?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`EMDEX Greenbook request failed (${res.status})`);
  }

  const json = await res.json();
  return {
    total: json.recordsFiltered ?? 0,
    recordsTotal: json.recordsTotal ?? 0,
    products: (json.data || []).map(normalizeGreenbookProduct)
  };
}

async function searchProducts({ q = "", page = 1, limit = 20 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const key = cacheKey([
    "search",
    q.trim().toLowerCase(),
    String(safePage),
    String(safeLimit)
  ]);
  const cached = readCache(key);
  if (cached) return cached;

  let products = [];
  let total = 0;
  let recordsTotal = 0;
  let source = "emdex-greenbook";

  if (apiClient.licensedApiEnabled() && q.trim()) {
    try {
      const brands = await apiClient.searchBrands({ keyword: q.trim() });
      products = brands.map(brandToProduct);
      total = products.length;
      recordsTotal = products.length;
      source = "emdex-api";
    } catch (err) {
      console.warn("EMDEX licensed search failed, using Greenbook:", err.message);
    }
  }

  if (products.length === 0) {
    const start = (safePage - 1) * safeLimit;
    const result = await queryGreenbook({
      start,
      length: safeLimit,
      search: q
    });
    products = result.products;
    total = result.total;
    recordsTotal = result.recordsTotal;
    source = "emdex-greenbook";
  } else {
    const start = (safePage - 1) * safeLimit;
    products = products.slice(start, start + safeLimit);
  }

  const payload = {
    page: safePage,
    limit: safeLimit,
    total,
    recordsTotal,
    products,
    source
  };
  writeCache(key, payload);
  return payload;
}

async function getCatalogStats() {
  const key = cacheKey(["stats"]);
  const cached = readCache(key);
  if (cached) return cached;

  const result = await queryGreenbook({ start: 0, length: 1, search: "" });
  const payload = {
    totalProducts: result.recordsTotal,
    source: "emdex-greenbook",
    licensedApiEnabled: apiClient.licensedApiEnabled()
  };
  writeCache(key, payload);
  return payload;
}

async function findByNafdacNumber(nafdacNumber) {
  const normalized = String(nafdacNumber || "").trim();
  if (!normalized) {
    return { found: false, products: [] };
  }

  const key = cacheKey(["nafdac", normalized.toLowerCase()]);
  const cached = readCache(key);
  if (cached) return cached;

  const result = await queryGreenbook({
    start: 0,
    length: 10,
    nafdacNumber: normalized
  });

  const payload = {
    found: result.products.length > 0,
    nafdacNumber: normalized,
    products: result.products
  };
  writeCache(key, payload);
  return payload;
}

async function getProductById(emdexProductId) {
  const id = Number(emdexProductId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid EMDEX product id");
  }

  const key = cacheKey(["product", String(id)]);
  const cached = readCache(key);
  if (cached) return cached;

  if (apiClient.licensedApiEnabled()) {
    try {
      const brand = await apiClient.getBrandDetails(id);
      if (brand) {
        const payload = { found: true, product: brandToProduct(brand) };
        writeCache(key, payload);
        return payload;
      }
    } catch (err) {
      console.warn("EMDEX brand details failed, trying Greenbook:", err.message);
    }
  }

  const result = await queryGreenbook({
    start: 0,
    length: 1,
    search: String(id)
  });

  const match =
    result.products.find((p) => p.emdexProductId === id) ||
    result.products[0] ||
    null;

  if (!match) {
    return { found: false, product: null };
  }

  const payload = { found: true, product: match };
  writeCache(key, payload);
  return payload;
}

function getIntegrationInfo() {
  return {
    greenbookUrl: GREENBOOK_BASE,
    licensedApi: apiClient.getClientInfo(),
    cacheTtlMs: CACHE_TTL_MS
  };
}

module.exports = {
  searchProducts,
  getCatalogStats,
  findByNafdacNumber,
  getProductById,
  getIntegrationInfo,
  normalizeGreenbookProduct,
  brandToProduct,
  apiClient
};
