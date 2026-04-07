/**
 * OpenAPI path items under /api/v1/admin/* — all require admin JWT (role: admin).
 */
const adminSec = [{ bearerAuth: [] }];

function getOp(summary, extra = {}) {
  return {
    tags: extra.tags || ["Admin"],
    summary,
    security: adminSec,
    responses: {
      200: {
        description: "Success",
        content: { "application/json": { schema: { $ref: "#/components/schemas/OkData" } } }
      },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden — admin role required" },
      ...extra.responsesExtra
    },
    parameters: extra.parameters,
    requestBody: extra.requestBody
  };
}

module.exports = {
  "/api/v1/admin/overview": {
    get: getOp("Admin dashboard overview (stats, charts)")
  },
  "/api/v1/admin/product-approvals": {
    get: getOp("Pending product applications list", {
      parameters: [
        {
          name: "q",
          in: "query",
          schema: { type: "string" },
          description: "Search product name, manufacturer, or NAFDAC number"
        }
      ]
    })
  },
  "/api/v1/admin/submissions/{id}": {
    get: getOp("Get product submission by MongoDB id", {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } }
      ],
      responsesExtra: { 400: { description: "Invalid id" }, 404: { description: "Not found" } }
    }),
    patch: getOp("Update submission checklist / internal notes", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                checklist: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      label: { type: "string" },
                      done: { type: "boolean" }
                    }
                  }
                },
                internalNotes: { type: "string" }
              }
            }
          }
        }
      }
    })
  },
  "/api/v1/admin/submissions/{id}/approve": {
    post: getOp("Approve submission", {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } }
      ],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { note: { type: "string", default: "" } }
            }
          }
        }
      }
    })
  },
  "/api/v1/admin/submissions/{id}/reject": {
    post: getOp("Reject submission", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["reason"],
              properties: { reason: { type: "string" } }
            }
          }
        }
      },
      responsesExtra: { 400: { description: "reason required" } }
    })
  },
  "/api/v1/admin/submissions/{id}/request-changes": {
    post: getOp("Request changes on submission", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["message"],
              properties: { message: { type: "string" } }
            }
          }
        }
      },
      responsesExtra: { 400: { description: "message required" } }
    })
  },
  "/api/v1/admin/submissions/{id}/documents/{index}": {
    patch: getOp("Update document verification status in submission", {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "index", in: "path", required: true, schema: { type: "integer", minimum: 0 } }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["status"],
              properties: {
                status: { type: "string", enum: ["pending", "verified", "rejected"] }
              }
            }
          }
        }
      },
      responsesExtra: { 400: { description: "Invalid status" }, 404: { description: "Submission or document not found" } }
    })
  },
  "/api/v1/admin/products": {
    get: getOp("List products (registry)", {
      parameters: [
        { name: "q", in: "query", schema: { type: "string" }, description: "Search filter" }
      ]
    })
  },
  "/api/v1/admin/products/{productId}/detail": {
    get: getOp("Product detail for admin", {
      parameters: [
        { name: "productId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }
      ],
      responsesExtra: { 404: { description: "Not found" } }
    })
  },
  "/api/v1/admin/products/{productId}/status": {
    post: getOp("Update on-chain drug status (approved/flagged/recalled)", {
      parameters: [
        { name: "productId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }
      ],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["chainStatus"],
              properties: {
                chainStatus: {
                  type: "string",
                  enum: ["approved", "flagged", "recalled"],
                  description: "Maps to contract status enum"
                },
                justification: { type: "string" }
              }
            }
          }
        }
      }
    })
  },
  "/api/v1/admin/products/{productId}/recall": {
    post: getOp("Recall product (on-chain + DB)", {
      parameters: [
        { name: "productId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }
      ],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                publicNotice: { type: "string", description: "Recall note (max ~2000 chars)" }
              }
            }
          }
        }
      }
    })
  },
  "/api/v1/admin/batches": {
    get: getOp("List batches", {
      parameters: [
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: { type: "string" } }
      ]
    })
  },
  "/api/v1/admin/batches/{batchKey}/detail": {
    get: getOp("Batch detail", {
      parameters: [{ name: "batchKey", in: "path", required: true, schema: { type: "string" } }],
      responsesExtra: { 404: { description: "Not found" } }
    })
  },
  "/api/v1/admin/batches/{batchKey}/flag": {
    post: getOp("Flag batch", {
      parameters: [{ name: "batchKey", in: "path", required: true, schema: { type: "string" } }]
    })
  },
  "/api/v1/admin/batches/{batchKey}/suspend": {
    post: getOp("Suspend batch", {
      parameters: [{ name: "batchKey", in: "path", required: true, schema: { type: "string" } }]
    })
  },
  "/api/v1/admin/batches/{batchKey}/recall": {
    post: getOp("Recall batch", {
      parameters: [{ name: "batchKey", in: "path", required: true, schema: { type: "string" } }]
    })
  },
  "/api/v1/admin/recalls": {
    get: getOp("List recall requests"),
    post: getOp("Create regulatory recall request", {
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["productName", "batchNumbers"],
              properties: {
                productName: { type: "string" },
                batchNumbers: { type: "string", description: "Batch label(s)" },
                severity: { type: "string" },
                reason: { type: "string" },
                detailDescription: { type: "string" },
                requiredActions: { type: "string" },
                riskAnalysis: { type: "string" }
              }
            }
          }
        }
      },
      responsesExtra: { 400: { description: "Missing required fields" } }
    })
  },
  "/api/v1/admin/recalls/{id}/approve": {
    post: getOp("Approve recall request", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responsesExtra: { 404: { description: "Not found" } }
    })
  },
  "/api/v1/admin/recalls/{id}/reject": {
    post: getOp("Reject recall request", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responsesExtra: { 404: { description: "Not found" } }
    })
  },
  "/api/v1/admin/suspicious-reports": {
    get: getOp("List suspicious product reports", {
      parameters: [
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: { type: "string" } }
      ]
    })
  },
  "/api/v1/admin/suspicious-reports/{id}": {
    get: getOp("Suspicious report detail", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responsesExtra: { 404: { description: "Not found" } }
    }),
    patch: getOp("Update suspicious report", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true }
          }
        }
      }
    })
  },
  "/api/v1/admin/manufacturers": {
    get: getOp("List manufacturers", {
      parameters: [{ name: "q", in: "query", schema: { type: "string" } }]
    })
  },
  "/api/v1/admin/manufacturers/{id}/detail": {
    get: getOp("Manufacturer detail", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responsesExtra: { 404: { description: "Not found" } }
    })
  },
  "/api/v1/admin/manufacturers/{id}/suspend-license": {
    post: getOp("Suspend manufacturer license", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true }
          }
        }
      }
    })
  },
  "/api/v1/admin/staff-users": {
    get: getOp("List admin staff users"),
    post: getOp("Create staff user", {
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true }
          }
        }
      }
    })
  },
  "/api/v1/admin/staff-users/{id}": {
    get: getOp("Staff user detail", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responsesExtra: { 404: { description: "Not found" } }
    })
  },
  "/api/v1/admin/staff-users/{id}/permissions": {
    patch: getOp("Update staff permissions", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true }
          }
        }
      }
    })
  },
  "/api/v1/admin/staff-users/{id}/deactivate": {
    post: getOp("Deactivate staff user", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }]
    })
  },
  "/api/v1/admin/staff-users/{id}/reset-password": {
    post: getOp("Reset staff password", {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true }
          }
        }
      }
    })
  },
  "/api/v1/admin/logs": {
    get: getOp("Audit / activity logs", {
      parameters: [
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "page", in: "query", schema: { type: "integer" } }
      ]
    })
  },
  "/api/v1/admin/analytics/regulatory": {
    get: getOp("Regulatory analytics dashboard data")
  },
  "/api/v1/admin/settings": {
    get: getOp("Platform settings"),
    patch: getOp("Update platform settings", {
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                general: { type: "object", additionalProperties: true },
                security: { type: "object", additionalProperties: true }
              }
            }
          }
        }
      }
    })
  },
  "/api/v1/admin/compliance/overview": {
    get: getOp("Compliance overview (KPIs, timeline)")
  },
  "/api/v1/admin/compliance/contact": {
    post: getOp("Submit compliance contact form", {
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["subject", "message"],
              properties: {
                subject: { type: "string" },
                message: { type: "string" },
                priority: { type: "string" }
              }
            }
          }
        }
      },
      responsesExtra: { 400: { description: "Missing subject or message" } }
    })
  }
};
