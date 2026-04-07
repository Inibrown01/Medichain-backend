const corePaths = require("./openapi-core-paths");
const adminPaths = require("./openapi-admin-paths");

/** OpenAPI 3.0 document for Swagger UI and tooling. */
module.exports = {
  openapi: "3.0.3",
  info: {
    title: "MediChain NG API",
    version: "1.0.0",
    description:
      "REST API for MediChain: on-chain drug registry (via backend signer), JWT auth for **admin** and **manufacturer**, IPFS (Pinata) for sensitive files, Cloudinary for public images, and admin dashboard routes.\n\n" +
      "**Authentication:** Use `POST /api/v1/auth/login` (admin) or `POST /api/v1/auth/manufacturer/login` (manufacturer). Click **Authorize** and paste `Bearer <token>` or just the token (Swagger adds Bearer).\n\n" +
      "Admin routes require `role: admin`. Manufacturer routes require `role: manufacturer`. Some upload routes accept either role.",
    contact: { name: "MediChain NG" }
  },
  servers: [
    { url: "http://localhost:4000", description: "Local (default PORT=4000)" },
    { url: "/", description: "Same origin (relative)" }
  ],
  tags: [
    { name: "System", description: "Liveness and integration status" },
    { name: "Auth", description: "Admin and manufacturer authentication" },
    { name: "Blockchain", description: "Registry reads and admin-only on-chain writes" },
    { name: "Analytics", description: "Dashboard analytics" },
    { name: "Manufacturer", description: "Manufacturer portal APIs" },
    { name: "Uploads", description: "IPFS and Cloudinary" },
    { name: "Admin", description: "Admin dashboard (JWT required)" }
  ],
  paths: {
    ...corePaths,
    ...adminPaths
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT from `POST /api/v1/auth/login` or `POST /api/v1/auth/manufacturer/login`"
      }
    },
    schemas: {
      OkData: {
        type: "object",
        properties: {
          ok: { type: "boolean", example: true },
          data: { type: "object", additionalProperties: true },
          message: { type: "string" }
        }
      },
      HealthResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          service: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
          integrations: {
            type: "object",
            properties: {
              blockchainRead: { type: "boolean" },
              blockchainWrite: { type: "boolean" },
              ipfsPinata: { type: "boolean" },
              cloudinary: { type: "boolean" }
            }
          }
        }
      },
      RegisterDrugBody: {
        type: "object",
        required: ["drugName", "manufacturer", "nafDacNumber", "batchNumber"],
        properties: {
          drugName: { type: "string", example: "Paracetamol 500mg" },
          manufacturer: { type: "string", example: "Example Pharma Ltd" },
          nafDacNumber: { type: "string", example: "05-1234" },
          batchNumber: { type: "string", example: "BATCH-2026-001" },
          ipfsCid: { type: "string", default: "", description: "Optional IPFS CID or ipfs:// URI" },
          manufacturerWallet: {
            type: "string",
            description: "Optional checksummed Ethereum address; omit or empty for zero address"
          }
        }
      },
      ProductApplicationBody: {
        type: "object",
        required: ["productName"],
        properties: {
          productName: { type: "string" },
          category: { type: "string" },
          productType: { type: "string", default: "MEDICINE" },
          description: { type: "string" },
          nafdacNumber: { type: "string" },
          approvalDate: { type: "string", format: "date" },
          expiryDate: { type: "string", format: "date" },
          location: { type: "string" },
          manufacturerName: { type: "string" },
          thumbnailUrl: { type: "string" },
          documents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                previewUrl: { type: "string" },
                mimeType: { type: "string" },
                fileName: { type: "string" }
              }
            }
          }
        }
      }
    }
  }
};
