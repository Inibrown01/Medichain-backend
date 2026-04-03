/**
 * Pin IPFS content via Pinata (sensitive regulatory docs, certificates, lab reports).
 * Set PINATA_JWT (recommended) or PINATA_API_KEY + PINATA_SECRET_KEY.
 * @see https://docs.pinata.cloud/
 */

const FormData = require("form-data");
const axios = require("axios");

const PIN_FILE = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PIN_JSON = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

function getHeaders() {
  const jwt = process.env.PINATA_JWT;
  if (jwt) {
    return { Authorization: `Bearer ${jwt}` };
  }
  const key = process.env.PINATA_API_KEY;
  const secret = process.env.PINATA_SECRET_KEY;
  if (key && secret) {
    return {
      pinata_api_key: key,
      pinata_secret_api_key: secret
    };
  }
  return null;
}

function isConfigured() {
  return Boolean(getHeaders());
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {object} [meta] optional Pinata metadata { name, keyvalues }
 * @returns {Promise<{ cid: string, pinSize: number }>}
 */
async function pinFile(buffer, filename, meta = {}) {
  const headers = getHeaders();
  if (!headers) {
    throw new Error("IPFS/Pinata is not configured (set PINATA_JWT or PINATA_API_KEY + PINATA_SECRET_KEY)");
  }

  const form = new FormData();
  form.append("file", buffer, { filename: filename || "document.bin" });

  const pinataOptions = JSON.stringify({
    cidVersion: 1
  });
  form.append("pinataOptions", pinataOptions);

  if (meta.name || Object.keys(meta.keyvalues || {}).length) {
    form.append(
      "pinataMetadata",
      JSON.stringify({
        name: meta.name || filename,
        keyvalues: meta.keyvalues || {}
      })
    );
  }

  const res = await axios.post(PIN_FILE, form, {
    headers: {
      ...headers,
      ...form.getHeaders()
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });

  const cid = res.data?.IpfsHash;
  if (!cid) {
    throw new Error("Pinata response missing IpfsHash");
  }

  return {
    cid,
    pinSize: res.data?.PinSize ?? buffer.length
  };
}

/**
 * @param {object} jsonBody — JSON-serializable metadata (hashes, structured form data)
 */
async function pinJson(jsonBody, name = "metadata.json") {
  const headers = getHeaders();
  if (!headers) {
    throw new Error("IPFS/Pinata is not configured");
  }

  const res = await axios.post(
    PIN_JSON,
    {
      pinataContent: jsonBody,
      pinataMetadata: { name },
      pinataOptions: { cidVersion: 1 }
    },
    { headers }
  );

  const cid = res.data?.IpfsHash;
  if (!cid) throw new Error("Pinata JSON pin missing IpfsHash");
  return { cid };
}

function gatewayUrl(cid, gateway = process.env.IPFS_GATEWAY_URL) {
  const base = (gateway || "https://gateway.pinata.cloud/ipfs").replace(/\/$/, "");
  return `${base}/${cid}`;
}

module.exports = {
  isConfigured,
  pinFile,
  pinJson,
  gatewayUrl
};
