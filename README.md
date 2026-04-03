# Medichain Express Backend

> **Full local setup, env tables, E2E curl flows, and deployment order:** see the repository **[`README.md`](../README.md)** at the repo root. This file focuses on API behavior and integration notes.

This folder contains the **Node.js + Express.js API** for the Medichain MVP.

It is designed around the requirements from the two source documents:

- MVP flow from `PharmVerify_MVP_and_Testing_Guide.pdf`:
  - `POST /register-drug`
  - `GET /verify-drug/:id`
  - `POST /recall-drug`
- Architecture from `Medichain Proposal.pdf`:
  - Express backend + Ethers.js smart contract integration
  - JWT auth for admin/manufacturer flows
  - MongoDB for rapid off-chain persistence
  - QR generation for scan-to-verify
  - Frontend-agnostic API that a React client can consume later

## What this backend currently includes

### Core API routes

- `POST /api/v1/register-drug`
  - Protected by admin JWT middleware.
  - Writes product on-chain through `registerDrug(...)`.
  - Waits for tx receipt.
  - Extracts `productId` from `DrugRegistered` event logs.
  - Returns `verifyUrl` + inline QR Data URL.

- `GET /api/v1/verify-drug/:id`
  - Reads product status by product ID.
  - Returns detailed record fields for verification page display.
  - Maps status enum to UI string:
    - `APPROVED => GENUINE`
    - `FLAGGED|RECALLED => FLAGGED`
    - missing => `NOT_REGISTERED`

- `GET /api/v1/verify-drug/batch/:batchNumber`
  - Reads status by batch number.
  - Useful for quick input-based verification when QR is unavailable.

- `POST /api/v1/recall-drug`
  - Protected by admin JWT middleware.
  - Calls on-chain `recallDrug(productId, recallNote)`.

- `POST /api/v1/auth/mock-admin-token`
  - Convenience endpoint for local MVP testing.
  - Generates a JWT with `role: "admin"` for protected routes.

- `POST /api/v1/auth/register-admin`
  - Creates an admin user in MongoDB with hashed password.

- `POST /api/v1/auth/login`
  - Authenticates admin user from MongoDB and returns JWT.

### Supporting modules

- `src/lib/blockchainClient.js`
  - Creates Ethers read/write contract clients from env vars.

- `src/db/mongoose.js`
  - Connects to MongoDB using `MONGODB_URI`.

- `src/models/*`
  - `AdminUser`: admin credentials/profile.
  - `ProductRecord`: denormalized product state mirrored from chain.
  - `VerificationLog`: query audit trail for verification requests.

- `src/contracts/pharmVerifyRegistryAbi.js`
  - Minimal ABI fragment for all methods/events used by this API.

- `src/middleware/auth.js`
  - Simple JWT role-based guard (`requireAdmin`).

- `src/services/qrService.js`
  - Generates QR PNG as Data URL that points to your frontend verification route.

## Folder structure

```txt
express-backend/
  src/
    contracts/
      pharmVerifyRegistryAbi.js
    lib/
      blockchainClient.js
    middleware/
      auth.js
    routes/
      drugRoutes.js
    services/
      qrService.js
    server.js
  .env.example
  package.json
  README.md
```

## Environment variables

Copy `.env.example` to `.env` and fill values:

- `PORT`: API server port (default `4000`)
- `JWT_SECRET`: token secret for admin auth
- `MONGODB_URI`: Mongo connection string
- `RPC_URL`: HTTPS RPC for the **same chain** as your deployment (e.g. Base Sepolia, Polygon Amoy — see root `README.md`)
- `CONTRACT_ADDRESS`: deployed `PharmVerifyRegistry` contract address
- `OWNER_PRIVATE_KEY`: wallet private key with admin/owner rights on contract
- Pinata / Cloudinary variables: see root `README.md` and `.env.example` (IPFS for sensitive files, Cloudinary for public images)

## Install and run locally

1. Install dependencies:
   - `npm install`
2. Configure `.env`.
3. Start:
   - `npm run dev`
4. Health check:
   - `GET /health`

## Integration with smart-contracts folder

This backend expects the contract from:

- `../smart-contracts/contracts/PharmVerifyRegistry.sol`

To wire both projects together:

1. Deploy contract from `smart-contracts/`.
2. Put deployed address into backend `.env` as `CONTRACT_ADDRESS`.
3. Ensure backend signer (`OWNER_PRIVATE_KEY`) is the contract owner (or update contract with role-based access).
4. Keep ABI signatures in `pharmVerifyRegistryAbi.js` aligned with Solidity contract changes.

## Frontend integration guide (for when you build React later)

The frontend will call this backend only; it does not need to talk directly to blockchain for basic user verification.

### 1) Registration flow (admin/manufacturer dashboard)

Expected frontend form fields:

- `drugName`
- `manufacturer`
- `nafDacNumber`
- `batchNumber`
- `ipfsCid` (optional in MVP)

Flow:

1. Frontend gets/admin stores JWT (for MVP can call mock token route).
2. Frontend POSTs to:
   - `POST /api/v1/register-drug`
3. Include `Authorization: Bearer <token>`.
4. Backend returns:
   - `productId`
   - `transactionHash`
   - `verifyUrl`
   - `qrCodeDataUrl`

Use returned `qrCodeDataUrl` to render/download product QR labels.

### 2) Public verification flow by QR

When user scans QR, open frontend route like:

- `/verify/:productId`

Then frontend page calls:

- `GET /api/v1/verify-drug/:id`

Display:

- product name
- manufacturer
- NAFDAC number
- batch number
- verification state (`GENUINE`, `FLAGGED`, `NOT_REGISTERED`)
- optional recall notice banner when status indicates recalled/flagged

### 3) Public verification flow by batch number input

Frontend search field submits:

- `GET /api/v1/verify-drug/batch/:batchNumber`

This supports manual lookup where camera scan is unavailable.

### 4) Admin recall flow

Dashboard action calls:

- `POST /api/v1/recall-drug`

Payload:

- `productId`
- `recallNote`

Use admin JWT in `Authorization` header.

## Security notes (important before production)

Current auth is intentionally minimal for MVP speed. Before production:

- Replace mock admin token endpoint with full login service.
- Use short-lived access tokens + refresh flow.
- Add request rate limiting.
- Add schema validation (e.g. `zod`/`joi`) for all payloads.
- Store audit logs in DB (already started with `VerificationLog`; expand as needed).
- Restrict CORS origins explicitly.
- Add HTTPS termination at deployment edge.

## Testing suggestions aligned with MVP document

To match the guide’s testing scenarios:

1. Drug registration simulation:
   - script 100 `register-drug` calls.
2. Counterfeit detection:
   - send duplicate batch numbers and check `FLAGGED`.
3. Verification speed:
   - measure p95 latency for `/verify-drug/:id`.
4. Unauthorized access:
   - call protected routes without token and with non-admin token.

## Deployment notes

Recommended MVP deployment stack from proposal:

- Backend hosting: Railway / Render
- Chain: Polygon Amoy or Base Sepolia testnet first (see `smart-contracts` README)

Deployment checklist:

1. Deploy contract, record address.
2. Set backend env vars on host.
3. Verify route health publicly.
4. Run smoke tests for register/verify/recall.
5. Connect frontend base URL for QR links.

