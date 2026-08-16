/**
 * Pushes Gambit's environment to the linked Vercel project.
 *
 * `vercel env add` takes the better part of a minute per variable and there are
 * ten of them; this is the same operation against the API, in one pass. It
 * reads the project from `.vercel/project.json` and the credentials the CLI
 * already holds, so there is nothing new to authorise.
 *
 * Values that must never reach a browser are marked sensitive, which is what
 * stops them being read back out of the dashboard.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GAMBIT_DB_SCHEMA",
  "CRON_SECRET"
];

const SERVER_ONLY = new Set(["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"]);

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) out[match[1]!] = match[2]!.trim();
  }
  return out;
}

function token(): string {
  const file = join(homedir(), "Library/Application Support/com.vercel.cli/auth.json");
  if (!existsSync(file)) throw new Error("the Vercel CLI is not logged in");
  return (JSON.parse(readFileSync(file, "utf8")) as { token: string }).token;
}

async function main(): Promise<void> {
  const project = JSON.parse(readFileSync(".vercel/project.json", "utf8")) as {
    projectId: string;
    orgId: string;
  };
  const values = env();
  const auth = { authorization: `Bearer ${token()}`, "content-type": "application/json" };
  const base = `https://api.vercel.com/v10/projects/${project.projectId}/env?teamId=${project.orgId}`;

  // Whatever is there now, for the keys we are about to set.
  const existing = (await (await fetch(`${base}&decrypt=false`, { headers: auth })).json()) as {
    envs: { id: string; key: string }[];
  };

  for (const key of KEYS) {
    const value = values[key];
    if (!value) {
      console.log(`  skip  ${key} (not set locally)`);
      continue;
    }

    for (const old of existing.envs.filter((e) => e.key === key)) {
      await fetch(
        `https://api.vercel.com/v9/projects/${project.projectId}/env/${old.id}?teamId=${project.orgId}`,
        { method: "DELETE", headers: auth }
      );
    }

    const res = await fetch(base, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        key,
        value,
        type: SERVER_ONLY.has(key) ? "sensitive" : "encrypted",
        // A sensitive value cannot be given to development: development reads
        // .env.local, and a value the dashboard will not show you is no use in
        // a shell anyway.
        target: SERVER_ONLY.has(key)
          ? ["production", "preview"]
          : ["production", "preview", "development"]
      })
    });
    if (!res.ok) throw new Error(`${key}: HTTP ${res.status} ${await res.text()}`);
    console.log(`  ok    ${key}${SERVER_ONLY.has(key) ? " (server-only)" : ""}`);
  }
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
