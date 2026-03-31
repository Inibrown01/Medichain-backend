const QRCode = require("qrcode");

async function generateVerificationQrDataUrl(productId) {
  const baseUrl =
    process.env.FRONTEND_BASE_URL || "https://verify.pharmverify.ng";
  const verifyUrl = `${baseUrl.replace(/\/$/, "")}/verify/${productId}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, {
    margin: 1,
    width: 240
  });

  return {
    verifyUrl,
    qrCodeDataUrl
  };
}

module.exports = {
  generateVerificationQrDataUrl
};

