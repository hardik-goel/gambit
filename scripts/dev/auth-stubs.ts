/**
 * The Supabase scaffolding a bare Postgres does not have.
 *
 * `auth.users` and `auth.uid()` are provided by the platform; the migrations
 * reference both. Creating the same shapes locally is what lets the schema be
 * verified without a Supabase project — see scripts/db-check.ts.
 */
import { Client } from "pg";

async function main(): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  `);
  await db.end();
  console.log("auth stubs ready");
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
