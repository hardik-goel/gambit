/**
 * Applies `supabase/migrations` to a database, once each.
 *
 *   DATABASE_URL=postgres://… pnpm db:migrate
 *
 * For Supabase, the connection string is under Project settings → Database →
 * Connection string → URI (the pooler one is fine).
 *
 * Every file is recorded in `schema_migrations` after it runs, so this is safe
 * to run again — it applies what is new and skips what is not. The same SQL is
 * verified against a throwaway Postgres by `pnpm db:check`.
 *
 * ## Sharing a project with something else
 *
 * By default everything lands in `public`, which is what a Supabase project
 * made for Gambit wants. If the project already belongs to another product,
 * set `GAMBIT_DB_SCHEMA=gambit` and every table, index, policy and function
 * goes into a schema of its own instead — no collision with whatever is
 * already in `public`, and `drop schema gambit cascade` removes Gambit whole.
 *
 * The migration files stay written against `public` so they can still be
 * pasted straight into the SQL editor; the rewrite happens here, at apply
 * time. `GAMBIT_DB_SCHEMA` must then be set for the app too, or the app will
 * look in `public` and find nothing.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { configuredSchema, renderForSchema } from "./lib/schema";

const MIGRATIONS = new URL("../supabase/migrations", import.meta.url).pathname;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("set DATABASE_URL to the database you want migrated");
    process.exit(1);
  }

  const schema = configuredSchema();

  const db = new Client({
    connectionString: url,
    // Supabase terminates TLS with its own certificate chain.
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? undefined : { rejectUnauthorized: false }
  });
  await db.connect();

  try {
    if (schema !== "public") console.log(`  into schema "${schema}"`);

    await db.query(`create schema if not exists ${schema};`);
    await db.query(`
      create table if not exists ${schema}.schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      );
    `);

    const { rows: applied } = await db.query<{ name: string; checksum: string }>(
      `select name, checksum from ${schema}.schema_migrations`
    );
    const seen = new Map(applied.map((r) => [r.name, r.checksum]));

    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    let ran = 0;

    for (const name of files) {
      const sql = readFileSync(join(MIGRATIONS, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
      const previous = seen.get(name);

      if (previous === checksum) {
        console.log(`  skip  ${name} (already applied)`);
        continue;
      }
      if (previous && previous !== checksum) {
        // Editing a migration that has already run is how two environments
        // quietly stop matching. Add a new file instead.
        console.error(`  STOP  ${name} has changed since it was applied. Write a new migration instead.`);
        process.exit(1);
      }

      await db.query("begin");
      try {
        await db.query(renderForSchema(sql, schema));
        await db.query(`insert into ${schema}.schema_migrations (name, checksum) values ($1, $2)`, [
          name,
          checksum
        ]);
        await db.query("commit");
        console.log(`  ok    ${name}`);
        ran++;
      } catch (e) {
        await db.query("rollback");
        throw e;
      }
    }

    // Supabase grants its three API roles access to `public` out of the box; a
    // schema we made ourselves starts with nothing, so PostgREST would answer
    // every request with "schema must be exposed". Row-level security is what
    // actually restricts these tables — it is on for all of them, and the
    // grants below only get the roles as far as the policies.
    await db.query(`
      do $grant$
      declare r text;
      begin
        foreach r in array array['anon', 'authenticated', 'service_role'] loop
          if exists (select 1 from pg_roles where rolname = r) then
            execute format('grant usage on schema %I to %I', '${schema}', r);
            execute format('grant all on all tables in schema %I to %I', '${schema}', r);
            execute format('grant all on all sequences in schema %I to %I', '${schema}', r);
            execute format('grant all on all functions in schema %I to %I', '${schema}', r);
            execute format(
              'alter default privileges in schema %I grant all on tables to %I', '${schema}', r);
          end if;
        end loop;
      end
      $grant$;
    `);

    console.log(ran === 0 ? "\nnothing to apply — the database is up to date" : `\napplied ${ran}`);

    if (schema !== "public") {
      console.log(
        [
          "",
          `Gambit's tables are in the "${schema}" schema, away from anything else in`,
          "this project. Two things must match it:",
          "",
          `  1. Supabase → Settings → API → Exposed schemas: add "${schema}"`,
          `  2. the app's environment: GAMBIT_DB_SCHEMA=${schema}`,
          "",
          "Without (1) the API refuses the schema; without (2) the app looks in public."
        ].join("\n")
      );
    }
  } finally {
    await db.end().catch(() => undefined);
  }
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
