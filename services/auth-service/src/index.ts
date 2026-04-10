/**
 * Auth Service
 *
 * Responsibilities:
 *   - User registration / login
 *   - JWT token issuance and verification
 *   - API key encryption and storage
 *   - Session management
 *
 * Exports an Express Router that the api-gateway mounts at /api.
 */

export { authRouter } from "./auth.router.js";
export { keysRouter } from "./keys.router.js";
export { signToken, verifyToken } from "./jwt.js";
export { encrypt, decrypt, safeDecrypt, isEncrypted } from "./encryption.js";
export { requireAuth } from "./middleware.js";
