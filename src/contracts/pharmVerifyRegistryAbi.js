const pharmVerifyRegistryAbi = [
  "function registerDrug(string drugName, string manufacturer, string nafDacNumber, string batchNumber, string ipfsCid, address manufacturerWallet) external returns (uint256)",
  "function productManufacturer(uint256 productId) external view returns (address)",
  "function getDrug(uint256 productId) external view returns (uint256,string,string,string,string,string,uint256,uint8,uint256,bool)",
  "function verifyDrug(uint256 productId) external view returns (uint8)",
  "function verifyByBatch(string batchNumber) external view returns (uint256,uint8)",
  "function recallDrug(uint256 productId, string recallNote) external",
  "function updateDrugStatus(uint256 productId, uint8 newStatus) external",
  "event DrugRegistered(uint256 indexed productId, bytes32 indexed batchHash, uint8 status, address indexed registeredBy)",
  "event DrugRecalled(uint256 indexed productId, string recallNote, address indexed recalledBy)",
  "event DrugStatusUpdated(uint256 indexed productId, uint8 newStatus, address indexed updatedBy)"
];

module.exports = {
  pharmVerifyRegistryAbi
};

