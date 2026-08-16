/**
 * Everything that can be wrong before a deploy, found in five seconds.
 *
 *   pnpm preflight
 *
 * `pnpm go-live` runs these same things the hard way — by migrating, testing
 * and deploying. This asks the cheap questions first: can we reach the
 * database, is the API answering, is the schema exposed, and — when the project
 * belongs to another product — is anything of ours about to collide with
 * anything of theirs.
 *
 * It writes nothing and prints no secrets. Safe to run against a database
 * somebody else is using, which is the case it was written for.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { configuredSchema } from "./lib/schema";

const ROOT = new URL("..", import.meta.url).pathname;

/** The eleven names Gambit wants. Several are common enough to collide. */
const GAMBIT_TABLES = [
  "profiles",
  "friendships",
  "rooms",
  "room_players",
  "games",
  "game_events",
  "game_moves",
  "game_results",
  "ratings",
  "chat_messages",
  "reports"
];

const results: { ok: boolean; text: string; detail?: string }[] = [];
function say(ok: boolean, text: string, detail?: string): void {
  results.push({ ok, text, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${text}${detail ? ` — ${detail}` : ""}`);
}

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [join(ROOT, ".env.local"), join(ROOT, ".env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match) out[match[1]!] = match[2]!.replace(/^["']|["']$/g, "").trim();
    }
  }
  return { ...out, ...process.env } as Record<string, string>;
}

/** A connection string with the password replaced by a shape. */
function redact(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, (_, user: string, pw: string) => `://${user}:${"•".repeat(Math.min(pw.length, 12))}@`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  // The schema comes from the same place everything else does — the file — so
  // this reports what a deploy would actually use, not what the shell happens
  // to have exported.
  const schema = configuredSchema(env.GAMBIT_DB_SCHEMA);

  console.log(`checking, with GAMBIT_DB_SCHEMA=${schema}\n`);

  /* ---- the four values ---- */
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DATABASE_URL"
  ]) {
    say(Boolean(env[key]), `${key} is set`, env[key] ? undefined : "missing from .env.local");
  }
  if (results.some((r) => !r.ok)) return finish();

  /* ---- the keys and the URL belong to the same project ---- */
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.NEXT_PUBLIC_SUPABASE_URL!)?.[1];
  say(Boolean(ref), "the project URL has the shape of a Supabase project", ref);
  if (ref && env.DATABASE_URL!.includes(ref)) {
    say(true, "the connection string points at that same project");
  } else if (ref && /pooler\.supabase\.com/.test(env.DATABASE_URL!)) {
    say(true, "the connection string is a pooler URL", "project not checkable from the host");
  } else {
    say(false, "the connection string points at that same project", "different project ref");
  }

  /* ---- can we reach the database at all ---- */
  const url = env.DATABASE_URL!;
  const db = new Client({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 12_000
  });

  try {
    await db.connect();
    say(true, "the database accepts the connection", redact(url).replace(/^postgres(ql)?:\/\//, ""));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    say(false, "the database accepts the connection", message);
    if (/password authentication failed/i.test(message)) {
      console.log(
        "\n      The password in DATABASE_URL is wrong, or has characters that need\n" +
          "      escaping (@ : / # ? are the usual ones). Reset it under Database →\n" +
          "      Settings if you no longer have it — but note that resetting breaks\n" +
          "      any existing direct connection, including another product's."
      );
    } else if (/ENETUNREACH|ENOTFOUND|EAI_AGAIN|timeout/i.test(message)) {
      console.log(
        "\n      Couldn't reach the host. Supabase's direct connection is IPv6-only\n" +
          "      and plenty of networks aren't. Use the Session pooler string from\n" +
          "      Connect → Direct (port 5432, host aws-…pooler.supabase.com)."
      );
    }
    return finish();
  }

  try {
    const { rows: version } = await db.query<{ v: string }>(`select version() as v`);
    say(true, "it is Postgres", version[0]!.v.split(" ").slice(0, 2).join(" "));

    /* ---- what is already in there ---- */
    const { rows: existing } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`
    );
    const theirs = existing.map((r) => r.table_name);
    const collisions = theirs.filter((t) => GAMBIT_TABLES.includes(t));

    if (schema === "public") {
      say(
        collisions.length === 0,
        "nothing in public collides with Gambit's tables",
        collisions.length
          ? `${collisions.join(", ")} already exist — set GAMBIT_DB_SCHEMA=gambit`
          : `${theirs.length} tables in public`
      );
    } else {
      say(true, "Gambit is going into its own schema, so public is untouched", `public has ${theirs.length} tables`);
      if (collisions.length) {
        console.log(
          `        (and would have collided on: ${collisions.join(", ")} — which is why)`
        );
      }
    }

    /* ---- is Gambit already there ---- */
    const { rows: mine } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = $1`,
      [schema]
    );
    const applied = mine.some((r) => r.table_name === "schema_migrations");
    say(
      true,
      applied ? `the "${schema}" schema is already migrated` : `the "${schema}" schema is not migrated yet`,
      applied ? `${mine.length} tables` : "go-live will create it"
    );

    /* ---- can we create a schema at all ---- */
    const { rows: perm } = await db.query<{ allowed: boolean }>(
      `select has_database_privilege(current_user, current_database(), 'CREATE') as allowed`
    );
    say(perm[0]!.allowed === true, "this user may create the schema", `as ${(await db.query<{ u: string }>(`select current_user as u`)).rows[0]!.u}`);
  } finally {
    await db.end().catch(() => undefined);
  }

  /* ---- PostgREST: is the schema reachable over the API ---- */
  //
  // Asking for a table that does not exist is the reliable probe: an exposed
  // schema answers PGRST205 (no such table), an unexposed one answers PGRST106
  // (invalid schema) and names the schemas it would accept. The root endpoint
  // cannot tell the two apart, which is how this check first passed when the
  // schema was not exposed at all.
  try {
    const res = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/gambit_schema_probe?select=*`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
          "accept-profile": schema
        }
      }
    );
    const body = (await res.json()) as { code?: string; hint?: string };
    say(res.status !== 401, "the service-role key is accepted by the API", `HTTP ${res.status}`);
    say(
      body.code !== "PGRST106",
      `the "${schema}" schema is exposed to the API`,
      body.code === "PGRST106"
        ? `add "${schema}" under Settings → API → Exposed schemas (${body.hint ?? ""})`
        : undefined
    );
  } catch (e) {
    say(false, "the API answered", e instanceof Error ? e.message : String(e));
  }

  finish();
}

function finish(): void {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("\nfix the above, then run this again. `pnpm go-live` when it is clean.");
    process.exit(1);
  }
  console.log("\nready. `pnpm go-live` will migrate, verify, deploy and print the URL.");
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
