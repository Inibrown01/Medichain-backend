/**
 * OpenAPI path items: /health, /api/v1/* (excluding /api/v1/admin/*)
 */
module.exports = {
  "/health": {
    get: {
      tags: ["System"],
      summary: "Health check",
      description:
        "Liveness probe and integration flags (blockchain read/write, Pinata, Cloudinary).",
      responses: {
        200: {
          description: "Service healthy",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HealthResponse" }
            }
          }
        }
      }
    }
  },
  "/api/v1/register-drug": {
    post: {
      tags: ["Blockchain"],
      summary: "Register drug on-chain",
      description:
        "Admin only. Calls `PharmVerifyRegistry.registerDrug`, mirrors state to MongoDB, returns QR payload.",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RegisterDrugBody" }
          }
        }
      },
      responses: {
        201: { description: "Registered", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        400: { description: "Validation error" },
        401: { description: "Unauthorized" },
        403: { description: "Forbidden — admin role required" },
        500: { description: "Server or blockchain error" }
      }
    }
  },
  "/api/v1/verify-drug/{id}": {
    get: {
      tags: ["Blockchain"],
      summary: "Verify product by numeric product ID",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer", minimum: 1 },
          description: "On-chain product ID"
        }
      ],
      responses: {
        200: { description: "Verification result", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        400: { description: "Invalid id" },
        404: { description: "Product not on chain (returns NOT_REGISTERED in body)" }
      }
    }
  },
  "/api/v1/verify-drug/batch/{batchNumber}": {
    get: {
      tags: ["Blockchain"],
      summary: "Verify by batch number",
      parameters: [
        {
          name: "batchNumber",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Batch identifier (URL-encoded if special chars)"
        }
      ],
      responses: {
        200: { description: "Verification result", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        400: { description: "Missing batch" },
        404: { description: "No match" }
      }
    }
  },
  "/api/v1/recall-drug": {
    post: {
      tags: ["Blockchain"],
      summary: "Recall drug on-chain",
      description: "Admin only. Calls `recallDrug` and updates MongoDB.",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["productId"],
              properties: {
                productId: { type: "integer", minimum: 1 },
                recallNote: { type: "string", default: "" }
              }
            }
          }
        }
      },
      responses: {
        200: { description: "Recalled", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        400: { description: "Invalid productId or chain revert" },
        401: { description: "Unauthorized" },
        403: { description: "Forbidden" }
      }
    }
  },
  "/api/v1/auth/register-admin": {
    post: {
      tags: ["Auth"],
      summary: "Register first admin user",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: { type: "string", format: "email" },
                password: { type: "string", minLength: 8 }
              }
            }
          }
        }
      },
      responses: {
        201: { description: "Created" },
        400: { description: "Validation error" },
        409: { description: "Admin already exists" }
      }
    }
  },
  "/api/v1/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Admin login",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: { type: "string", format: "email" },
                password: { type: "string" }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: "JWT issued",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: { token: { type: "string" } }
                  }
                }
              }
            }
          }
        },
        401: { description: "Invalid credentials" }
      }
    }
  },
  "/api/v1/auth/mock-admin-token": {
    post: {
      tags: ["Auth"],
      summary: "Dev-only mock admin JWT",
      description: "Returns a short-lived admin token without DB user. Requires `JWT_SECRET`. **Do not use in production.**",
      responses: {
        200: { description: "Token", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        500: { description: "JWT_SECRET missing" }
      }
    }
  },
  "/api/v1/analytics/dashboard": {
    get: {
      tags: ["Analytics"],
      summary: "Manufacturer dashboard analytics (weekly verification + activity)",
      parameters: [
        {
          name: "manufacturer",
          in: "query",
          required: false,
          schema: { type: "string" },
          description: "Filter logs by manufacturer name (exact match, case-insensitive)"
        }
      ],
      responses: {
        200: { description: "Chart data", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } }
      }
    }
  },
  "/api/v1/auth/manufacturer/register": {
    post: {
      tags: ["Auth"],
      summary: "Register manufacturer account",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password", "companyName"],
              properties: {
                email: { type: "string", format: "email" },
                password: { type: "string", minLength: 8 },
                companyName: { type: "string" }
              }
            }
          }
        }
      },
      responses: {
        201: { description: "Registered" },
        400: { description: "Validation error" },
        409: { description: "Email already registered" }
      }
    }
  },
  "/api/v1/auth/manufacturer/login": {
    post: {
      tags: ["Auth"],
      summary: "Manufacturer login",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: { type: "string", format: "email" },
                password: { type: "string" }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: "JWT + profile",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: {
                      token: { type: "string" },
                      companyName: { type: "string" },
                      email: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        },
        401: { description: "Invalid credentials or inactive account" }
      }
    }
  },
  "/api/v1/manufacturer/product-applications": {
    get: {
      tags: ["Manufacturer"],
      summary: "List my product applications",
      security: [{ bearerAuth: [] }],
      description: "Requires JWT with `role: manufacturer`.",
      responses: {
        200: { description: "List", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        401: { description: "Unauthorized" },
        403: { description: "Not a manufacturer" }
      }
    },
    post: {
      tags: ["Manufacturer"],
      summary: "Submit product application (off-chain queue)",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ProductApplicationBody" }
          }
        }
      },
      responses: {
        201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        400: { description: "Validation error" },
        401: { description: "Unauthorized" },
        403: { description: "Not a manufacturer" }
      }
    }
  },
  "/api/v1/uploads/ipfs": {
    post: {
      tags: ["Uploads"],
      summary: "Pin file to IPFS (Pinata)",
      description: "Admin or manufacturer JWT. Multipart field name: `file`.",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: {
                file: { type: "string", format: "binary", description: "Sensitive / trust-critical document" }
              }
            }
          }
        }
      },
      responses: {
        201: { description: "Pinned", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        400: { description: "Missing file" },
        401: { description: "Unauthorized" },
        403: { description: "Forbidden" },
        503: { description: "Pinata not configured" }
      }
    }
  },
  "/api/v1/uploads/ipfs-json": {
    post: {
      tags: ["Uploads"],
      summary: "Pin JSON object to IPFS",
      description: "Admin or manufacturer JWT. Body is the JSON to pin.",
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
            examples: {
              sample: { summary: "Example", value: { productName: "Example", meta: "..." } }
            }
          }
        }
      },
      responses: {
        201: { description: "Pinned", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        400: { description: "Invalid body" },
        503: { description: "Pinata not configured" }
      }
    }
  },
  "/api/v1/uploads/image": {
    post: {
      tags: ["Uploads"],
      summary: "Upload public image (Cloudinary)",
      description: "No JWT. Optional query `folder` (default `medichain/public`). **Rate-limit in production.**",
      parameters: [
        {
          name: "folder",
          in: "query",
          schema: { type: "string" },
          description: "Cloudinary folder path"
        }
      ],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: {
                file: { type: "string", format: "binary", description: "Image file" }
              }
            }
          }
        }
      },
      responses: {
        201: { description: "Uploaded", content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } } },
        400: { description: "Missing file" },
        503: { description: "Cloudinary not configured" }
      }
    }
  }
};
