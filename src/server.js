require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");
const { connectMongo } = require("./db/mongoose");
const { hasBlockchainReadConfig, hasBlockchainWriteConfig } = require("./lib/blockchainClient");
const ipfsService = require("./services/ipfsService");
const cloudinaryService = require("./services/cloudinaryService");
const drugRoutes = require("./routes/drugRoutes");
const adminRoutes = require("./routes/adminRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const openApiDocument = require("./docs/openapi");

const app = express();
const port = Number(process.env.PORT || 4000);

// Behind cPanel / nginx / Passenger on shared hosting, trust first proxy for correct client IP and HTTPS.
if (process.env.TRUST_PROXY !== "0") {
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
}

app.use(cors());

app.get("/openapi.json", (_req, res) => {
  res.json(openApiDocument);
});

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: "MediChain API",
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: "list",
      filter: true
    }
  })
);

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "medichain-express-backend",
    timestamp: new Date().toISOString(),
    integrations: {
      blockchainRead: hasBlockchainReadConfig(),
      blockchainWrite: hasBlockchainWriteConfig(),
      ipfsPinata: ipfsService.isConfigured(),
      cloudinary: cloudinaryService.isConfigured()
    }
  });
});

app.use("/api/v1", drugRoutes);
app.use("/api/v1", uploadRoutes);
app.use("/api/v1/admin", adminRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: "INTERNAL_SERVER_ERROR",
    message: err.message || "Something went wrong"
  });
});

async function bootstrap() {
  await connectMongo();
  app.listen(port, () => {
    console.log(`Medichain API running on port ${port}`);
    console.log(`OpenAPI / Swagger UI: http://localhost:${port}/api-docs`);
    console.log(`OpenAPI JSON: http://localhost:${port}/openapi.json`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start Medichain API:", error.message);
  process.exit(1);
});

