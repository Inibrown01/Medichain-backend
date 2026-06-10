/**
 * Licensed EMDEX REST API client (sandbox.emdexapi.com).
 * Endpoints from: express-backend/EMDEX DB API Doc.postman_collection.json
 */

const API_BASE =
  process.env.EMDEX_API_BASE_URL || "https://sandbox.emdexapi.com";

let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

function licensedApiEnabled() {
  return Boolean(process.env.EMDEX_EMAIL && process.env.EMDEX_PASSWORD);
}

function pickToken(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.token ||
    payload.access_token ||
    payload.accessToken ||
    payload.data?.token ||
    payload.data?.access_token ||
    null
  );
}

function pickList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const candidates = [
    payload.data,
    payload.brands,
    payload.generics,
    payload.companies,
    payload.results,
    payload.items
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function pickRecord(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload)) return payload[0] || null;
  return payload.data || payload.brand || payload.generic || payload.company || payload;
}

async function postForm(path, fields, { auth = true } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }

  const headers = { Accept: "application/json" };
  if (auth) {
    const token = await getAccessToken();
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: form
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`EMDEX API returned non-JSON (${res.status})`);
  }

  if (!res.ok) {
    const msg =
      json.message || json.error || `EMDEX API error (${res.status})`;
    throw new Error(msg);
  }

  return json;
}

async function login() {
  const email = process.env.EMDEX_EMAIL;
  const password = process.env.EMDEX_PASSWORD;
  if (!email || !password) {
    throw new Error("EMDEX_EMAIL and EMDEX_PASSWORD are required");
  }

  const json = await postForm(
    "/api/v1/login",
    { email, password },
    { auth: false }
  );
  const token = pickToken(json);
  if (!token) {
    throw new Error("EMDEX login succeeded but no token was returned");
  }

  tokenCache = {
    accessToken: token,
    expiresAt: Date.now() + 55 * 60 * 1000
  };
  return token;
}

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }
  return login();
}

async function refreshToken() {
  try {
    const json = await postForm("/api/v1/refresh", {});
    const token = pickToken(json);
    if (token) {
      tokenCache = {
        accessToken: token,
        expiresAt: Date.now() + 55 * 60 * 1000
      };
      return token;
    }
  } catch {
    // fall through to full login
  }
  return login();
}

async function authedPost(path, fields) {
  try {
    return await postForm(path, fields);
  } catch (err) {
    if (
      err &&
      typeof err.message === "string" &&
      /unauthorized|token|401/i.test(err.message)
    ) {
      await refreshToken();
      return postForm(path, fields);
    }
    throw err;
  }
}

function normalizeBrand(row) {
  return {
    id: row.id ?? row.brand_id ?? row.brandId ?? null,
    name: row.name || row.brand_name || row.brandName || "",
    genericName: row.generic_name || row.genericName || row.generic || "",
    nafdacNumber: row.nafdac || row.nafdac_no || row.NAFDAC || row.nafdacNumber || "",
    strength: row.strength || "",
    dosageForm: row.form || row.dosage_form || row.dosageForm || "",
    manufacturer: row.manufacturer || row.company || row.company_name || "",
    packSize: row.pack_size || row.packSize || "",
    status: row.status || "",
    source: "emdex-api"
  };
}

function normalizeGeneric(row) {
  return {
    id: row.id ?? row.generic_id ?? row.genericId ?? null,
    name: row.name || row.generic_name || row.genericName || "",
    synonym: row.synonym || "",
    atc: row.atc || "",
    source: "emdex-api"
  };
}

function normalizeCompany(row) {
  return {
    id: row.id ?? row.company_id ?? row.companyId ?? null,
    name: row.name || row.company_name || row.companyName || "",
    address: row.address || "",
    source: "emdex-api"
  };
}

async function searchBrands({ keyword = "", form = "", strength = "" }) {
  const json = await authedPost("/api/v1/brand/search", {
    keyword,
    form,
    strength
  });
  return pickList(json).map(normalizeBrand);
}

async function defaultSearchBrands({ keyword = "", form = "", strength = "" }) {
  const json = await authedPost("/api/v1/brand/defaultsearch", {
    keyword,
    form,
    strength
  });
  return pickList(json).map(normalizeBrand);
}

async function getBrandDetails(id) {
  const json = await authedPost("/api/v1/brand/", { id });
  const row = pickRecord(json);
  return row ? normalizeBrand(row) : null;
}

async function searchGenerics({ keyword = "" }) {
  const json = await authedPost("/api/v1/generic/search", { keyword });
  return pickList(json).map(normalizeGeneric);
}

async function getGenericDetails(id) {
  const json = await authedPost("/api/v1/generic", { id });
  const row = pickRecord(json);
  return row ? normalizeGeneric(row) : null;
}

async function getGenericBrands(id) {
  const json = await authedPost(`/api/v1/generic/${id}/brands/`, {});
  return pickList(json).map(normalizeBrand);
}

async function searchCompanies({ keyword = "" }) {
  const json = await authedPost("/api/v1/company/search", { keyword });
  return pickList(json).map(normalizeCompany);
}

async function getCompanyDetails(id) {
  const json = await authedPost("/api/v1/company", { id });
  const row = pickRecord(json);
  return row ? normalizeCompany(row) : null;
}

function getClientInfo() {
  return {
    baseUrl: API_BASE,
    enabled: licensedApiEnabled(),
    authenticated: Boolean(tokenCache.accessToken)
  };
}

module.exports = {
  licensedApiEnabled,
  searchBrands,
  defaultSearchBrands,
  getBrandDetails,
  searchGenerics,
  getGenericDetails,
  getGenericBrands,
  searchCompanies,
  getCompanyDetails,
  getClientInfo
};
