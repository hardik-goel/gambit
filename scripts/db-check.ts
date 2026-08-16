/**
 * Runs the production schema against a real Postgres.
 *
 * Everything else in this repository is verified by execution; the SQL was the
 * one part taken on trust. This applies `supabase/migrations/*.sql` to a live
 * database and then exercises the piece the whole platform leans on —
 * `append_game_events`, the single transaction that checks the version, writes
 * the events and the move, and saves the new state.
 *
 *   pnpm db:check                       # starts a throwaway Postgres in Docker
 *   DATABASE_URL=postgres://… pnpm db:check   # or points at one you already have
 *
 * Supabase supplies `auth.users` and `auth.uid()`; a bare Postgres does not, so
 * the harness creates the same shapes first. That is the only difference
 * between this and the real thing.
 *
 * The whole battery runs twice: once in `public`, and once in a schema of its
 * own — the arrangement used when the Supabase project is shared with another
 * product. Both must behave identically, which is the point of checking.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { renderForSchema } from "./lib/schema";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "supabase/migrations");
const CONTAINER = "gambit-schema-check";
const PORT = 55432;

const checks: { name: string; ok: boolean; detail?: string }[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  console.log(
    `${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

const docker = (...args: string[]): string => {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
};

async function connect(url: string, attempts = 40): Promise<Client> {
  for (let i = 0; i < attempts; i++) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("postgres never came up");
}

/** Everything the platform leans on, verified in whichever schema it sits in. */
async function runChecks(db: Client, schema: string): Promise<void> {
  const where = schema === "public" ? "" : ` [${schema}]`;
  const check = (name: string, ok: boolean, detail?: string): void =>
    record(name + where, ok, detail);

  await db.query(`create schema if not exists ${schema};`);

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    await db.query(renderForSchema(sql, schema));
    check(`${file} applies to a real Postgres`, true);
  }

  /* ---- every table has row-level security on ---- */
  const { rows: tables } = await db.query<{
    tablename: string;
    rowsecurity: boolean;
  }>(
    `select tablename, rowsecurity from pg_tables where schemaname = '${schema}' order by tablename`,
  );
  const unprotected = tables
    .filter((t) => !t.rowsecurity)
    .map((t) => t.tablename);
  check(
    "row-level security is on for every table",
    unprotected.length === 0,
    unprotected.length
      ? `missing on ${unprotected.join(", ")}`
      : `${tables.length} tables`,
  );

  /* ---- the hidden-information tables have no read policy at all ---- */
  const { rows: policies } = await db.query<{ tablename: string; cmd: string }>(
    `select tablename, cmd from pg_policies where schemaname = '${schema}'`,
  );
  const readable = new Set(
    policies.filter((p) => p.cmd === "SELECT").map((p) => p.tablename),
  );
  check(
    "game state is readable by nobody but the service role",
    !readable.has("games"),
    readable.has("games")
      ? "games has a select policy"
      : "no select policy on games",
  );
  check("moves are service-role only too", !readable.has("game_moves"));
  check(
    "the event log is readable, and filtered by seat",
    readable.has("game_events"),
  );

  /* ---- the atomic append ---- */
  const room = "11111111-1111-1111-1111-111111111111";
  await db.query(
    `insert into ${schema}.rooms (id, code, game_id, status, seed) values ($1, 'ABCDEF', 'chess', 'playing', 'seed-1')`,
    [room],
  );

  const first = await db.query<{
    version: number;
    first_seq: string;
    last_seq: string;
  }>(
    `select * from ${schema}.append_game_events($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7)`,
    [
      room,
      0,
      JSON.stringify({ ply: 1 }),
      JSON.stringify([{ type: "move", text: "e4" }]),
      0,
      JSON.stringify({ kind: "move", from: 52, to: 36 }),
      "key-1",
    ],
  );
  check(
    "the first append lands at version 1",
    first.rows[0]?.version === 1,
    `version ${first.rows[0]?.version}`,
  );

  const { rows: stateRows } = await db.query<{
    version: number;
    state: { ply: number };
  }>(`select version, state from ${schema}.games where room_id = $1`, [room]);
  check(
    "it saved the state alongside the version",
    stateRows[0]?.state.ply === 1,
  );

  const { rows: eventRows } = await db.query<{
    event: { type: string };
    visible_to: number[] | null;
  }>(
    `select event, visible_to from ${schema}.game_events where room_id = $1 order by seq`,
    [room],
  );
  check("it wrote the event", eventRows[0]?.event.type === "move");
  check("a public event has no seat list", eventRows[0]?.visible_to === null);

  // A stale writer must be refused, not allowed to clobber.
  let refused = false;
  try {
    await db.query(
      `select * from ${schema}.append_game_events($1, $2, $3::jsonb, $4::jsonb, $5, null, null)`,
      [
        room,
        0,
        JSON.stringify({ ply: 99 }),
        JSON.stringify([{ type: "move" }]),
        0,
      ],
    );
  } catch (e) {
    refused = /version conflict/.test(String((e as Error).message));
  }
  check("a stale version is refused rather than clobbering", refused);

  const { rows: afterConflict } = await db.query<{ state: { ply: number } }>(
    `select state from ${schema}.games where room_id = $1`,
    [room],
  );
  check(
    "and the refused write changed nothing",
    afterConflict[0]?.state.ply === 1,
  );

  // A private event carries its seat list through to the column the policy reads.
  await db.query(
    `select * from ${schema}.append_game_events($1, $2, $3::jsonb, $4::jsonb, $5, null, null)`,
    [
      room,
      1,
      JSON.stringify({ ply: 2 }),
      JSON.stringify([{ type: "deal", visibleTo: [1, 2] }]),
      1,
    ],
  );
  const { rows: privateRows } = await db.query<{ visible_to: number[] | null }>(
    `select visible_to from ${schema}.game_events where room_id = $1 order by seq desc limit 1`,
    [room],
  );
  check(
    "a private event keeps its seat list",
    JSON.stringify(privateRows[0]?.visible_to) === "[1,2]",
    JSON.stringify(privateRows[0]?.visible_to),
  );

  // The same idempotency key must never write two moves.
  await db.query(
    `select * from ${schema}.append_game_events($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7)`,
    [
      room,
      2,
      JSON.stringify({ ply: 3 }),
      JSON.stringify([{ type: "move" }]),
      0,
      JSON.stringify({ kind: "move" }),
      "key-1",
    ],
  );
  const { rows: moveRows } = await db.query<{ count: string }>(
    `select count(*)::text as count from ${schema}.game_moves where room_id = $1 and idempotency_key = 'key-1'`,
    [room],
  );
  check(
    "a repeated idempotency key writes one move, not two",
    moveRows[0]?.count === "1",
  );

  /* ---- the code constraint ---- */
  let rejectedCode = false;
  try {
    await db.query(
      `insert into ${schema}.rooms (code, game_id, status, seed) values ('lower!', 'chess', 'lobby', 's')`,
    );
  } catch {
    rejectedCode = true;
  }
  check(
    "room codes are constrained to six upper-case characters",
    rejectedCode,
  );
}

async function main(): Promise<void> {
  let url = process.env.DATABASE_URL ?? "";
  let started = false;

  if (!url) {
    if (!docker("version")) {
      console.error(
        "no DATABASE_URL and no Docker. Start one, or point DATABASE_URL at a Postgres.",
      );
      process.exit(1);
    }
    docker("rm", "-f", CONTAINER);
    console.log("starting a throwaway Postgres…");
    docker(
      "run",
      "-d",
      "--rm",
      "--name",
      CONTAINER,
      "-e",
      "POSTGRES_PASSWORD=gambit",
      "-e",
      "POSTGRES_DB=gambit",
      "-p",
      `${PORT}:5432`,
      "postgres:16-alpine",
    );
    started = true;
    url = `postgres://postgres:gambit@127.0.0.1:${PORT}/gambit`;
  }

  const db = await connect(url);
  try {
    // Supabase's own scaffolding, which the migration expects to exist.
    await db.query(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      create or replace function auth.uid() returns uuid
        language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create role authenticated;
    `);

    await runChecks(db, "public");

    // The same schema again, somewhere else entirely: this is what a project
    // shared with another product gets, and it must be no different.
    await runChecks(db, "gambit");
  } finally {
    await db.end().catch(() => undefined);
    if (started) docker("rm", "-f", CONTAINER);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed`,
  );
  if (failed.length) process.exit(1);
}

void main().catch((e: unknown) => {
  console.error(e);
  docker("rm", "-f", CONTAINER);
  process.exit(1);
});
