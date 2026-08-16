/**
 * Points the Vercel project at apps/web.
 *
 * The app is one workspace among seventeen, so the deploy has to install from
 * the repository root and build from the app. Vercel does exactly that once the
 * project's Root Directory names the app: it finds the pnpm workspace above it
 * and installs the whole thing, then builds only what it was pointed at.
 *
 * Custom install and build commands were the wrong way round — they installed
 * the workspace but left Vercel looking for Next in the root package.json,
 * where it will never be.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

async function main(): Promise<void> {
  const project = JSON.parse(readFileSync(".vercel/project.json", "utf8")) as {
    projectId: string;
    orgId: string;
  };
  const file = join(homedir(), "Library/Application Support/com.vercel.cli/auth.json");
  if (!existsSync(file)) throw new Error("the Vercel CLI is not logged in");
  const { token } = JSON.parse(readFileSync(file, "utf8")) as { token: string };

  const res = await fetch(
    `https://api.vercel.com/v9/projects/${project.projectId}?teamId=${project.orgId}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        rootDirectory: "apps/web",
        framework: "nextjs",
        installCommand: null,
        buildCommand: null,
        outputDirectory: null
      })
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  const updated = (await res.json()) as { name: string; rootDirectory: string; framework: string };
  console.log(`${updated.name}: root ${updated.rootDirectory}, framework ${updated.framework}`);
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
