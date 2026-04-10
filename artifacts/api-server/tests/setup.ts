/**
 * Vitest global setup — runs before every test file.
 *
 * Responsibilities:
 *   1. Load .env so DATABASE_URL / SESSION_SECRET / PORT are available
 *      when tests import app.ts (which imports config/env.ts at the top).
 *   2. Set a safe PORT so the imported app never binds to a socket
 *      (tests use supertest which handles the binding itself).
 */

import "dotenv/config";

// Ensure a test port so the app bootstrap doesn't conflict with the dev server
process.env["PORT"] ??= "8099";
process.env["NODE_ENV"] ??= "test";
