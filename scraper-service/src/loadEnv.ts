/**
 * Loads .env, as a side effect, before anything else.
 *
 * WHY THIS IS A MODULE AND NOT A dotenv.config() CALL IN index.ts
 * ---------------------------------------------------------------
 * The ESM-to-CJS transform (tsc and tsx/esbuild alike) hoists every import's
 * `require()` above the file's other top-level statements. So a
 * `dotenv.config()` written between two imports still runs AFTER every imported
 * module has already been evaluated — and modules that read env at import time
 * (src/auth/clerk.ts, src/db/supabase.ts) saw an unpopulated process.env and
 * threw. Relative order BETWEEN imports is preserved, though, which is why this
 * works: import it first and its side effect happens first.
 *
 * Any entrypoint that reads env must import this before anything else.
 */
import dotenv from "dotenv";

dotenv.config();
