require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { connectMongo } = require("./db/mongoose");
const { hasBlockchainReadConfig, hasBlockchainWriteConfig } = require("./lib/blockchainClient");
const ipfsService = require("./services/ipfsService");
const cloudinaryService = require("./services/cloudinaryService");
const drugRoutes = require("./routes/drugRoutes");
const adminRoutes = require("./routes/adminRoutes");
const uploadRoutes = require("./routes/uploadRoutes");

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(helmet());
app.use(cors());
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
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start Medichain API:", error.message);
  process.exit(1);
});

