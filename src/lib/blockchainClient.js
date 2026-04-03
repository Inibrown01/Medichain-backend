const { ethers } = require("ethers");
const { pharmVerifyRegistryAbi } = require("../contracts/pharmVerifyRegistryAbi");

function hasBlockchainReadConfig() {
  return Boolean(process.env.RPC_URL && process.env.CONTRACT_ADDRESS);
}

function hasBlockchainWriteConfig() {
  return Boolean(
    process.env.RPC_URL && process.env.CONTRACT_ADDRESS && process.env.OWNER_PRIVATE_KEY
  );
}

function getReadContract() {
  const rpcUrl = process.env.RPC_URL;
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!rpcUrl || !contractAddress) {
    throw new Error("Missing RPC_URL or CONTRACT_ADDRESS in environment");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Contract(contractAddress, pharmVerifyRegistryAbi, provider);
}

function getWriteContract() {
  const rpcUrl = process.env.RPC_URL;
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const privateKey = process.env.OWNER_PRIVATE_KEY;

  if (!rpcUrl || !contractAddress || !privateKey) {
    throw new Error(
      "Missing RPC_URL, CONTRACT_ADDRESS, or OWNER_PRIVATE_KEY in environment"
    );
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  return new ethers.Contract(contractAddress, pharmVerifyRegistryAbi, wallet);
}

module.exports = {
  getReadContract,
  getWriteContract,
  hasBlockchainReadConfig,
  hasBlockchainWriteConfig
};

