/**
 * Where Gambit's tables live.
 *
 * The migrations are written against `public`, because that is what a project
 * made for Gambit wants and what can be pasted straight into the SQL editor.
 * When the project is shared with another product, `GAMBIT_DB_SCHEMA` moves
 * the whole set into a schema of its own and this is the rewrite that does it.
 */

/** Postgres identifiers we are willing to interpolate into DDL. */
export function safeSchema(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`schema must be a plain lowercase identifier; got "${name}"`);
  }
  return name;
}

/**
 * Rewrites a migration authored against `public` to target another schema.
 *
 * Only schema-qualified references move: `public.games`, and the function's own
 * `set search_path = public`. Policy names that happen to contain the word
 * ("ratings are public") are left alone — which is why this matches a trailing
 * dot rather than the bare word.
 */
export function renderForSchema(sql: string, schema: string): string {
  if (safeSchema(schema) === "public") return sql;
  return sql
    .replace(/\bpublic\./g, `${schema}.`)
    .replace(/set\s+search_path\s*=\s*public\b/g, `set search_path = ${schema}`);
}

/** The schema the app and the migrations should agree on. */
export const configuredSchema = (): string =>
  safeSchema(process.env.GAMBIT_DB_SCHEMA?.trim() || "public");
