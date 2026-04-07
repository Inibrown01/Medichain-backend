const jwt = require("jsonwebtoken");

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED",
      message: "Missing bearer token"
    });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const payload = jwt.verify(token, secret);
    if (payload && payload.type === "refresh") {
      return res.status(401).json({
        ok: false,
        error: "INVALID_TOKEN",
        message: "Use access token in Authorization header, not refresh token"
      });
    }
    if (!payload || payload.role !== "admin") {
      return res.status(403).json({
        ok: false,
        error: "FORBIDDEN",
        message: "Admin role required"
      });
    }

    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: "INVALID_TOKEN",
      message: error.message || "Token verification failed"
    });
  }
}

function requireManufacturer(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED",
      message: "Missing bearer token"
    });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const payload = jwt.verify(token, secret);
    if (payload && payload.type === "refresh") {
      return res.status(401).json({
        ok: false,
        error: "INVALID_TOKEN",
        message: "Use access token in Authorization header, not refresh token"
      });
    }
    if (!payload || payload.role !== "manufacturer") {
      return res.status(403).json({
        ok: false,
        error: "FORBIDDEN",
        message: "Manufacturer role required"
      });
    }

    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: "INVALID_TOKEN",
      message: error.message || "Token verification failed"
    });
  }
}

function requireManufacturerOrAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED",
      message: "Missing bearer token"
    });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const payload = jwt.verify(token, secret);
    if (payload && payload.type === "refresh") {
      return res.status(401).json({
        ok: false,
        error: "INVALID_TOKEN",
        message: "Use access token in Authorization header, not refresh token"
      });
    }
    if (!payload || (payload.role !== "admin" && payload.role !== "manufacturer")) {
      return res.status(403).json({
        ok: false,
        error: "FORBIDDEN",
        message: "Admin or manufacturer role required"
      });
    }

    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: "INVALID_TOKEN",
      message: error.message || "Token verification failed"
    });
  }
}

module.exports = {
  requireAdmin,
  requireManufacturer,
  requireManufacturerOrAdmin
};

