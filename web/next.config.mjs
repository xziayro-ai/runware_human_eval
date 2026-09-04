import { config } from "dotenv";
import path from "node:path";

// Reuse the single repo-root .env (also used by scripts/upload_results.py)
// instead of duplicating the Supabase URL/key in a separate web/.env.local.
// override: true because some shells export an unrelated global SUPABASE_URL,
// which would otherwise silently win over this project's .env.
config({ path: path.resolve(process.cwd(), "..", ".env"), override: true });

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.SUPABASE_URL ??
      (process.env.SUPABASE_PROJECT_ID
        ? `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`
        : undefined),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_API_KEY,
  },
};

export default nextConfig;
