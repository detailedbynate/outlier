import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Minimal stand-in for the pieces of Supabase the migrations depend on
 * (auth schema, auth.uid(), and the API roles), so migrations can be applied
 * to an in-memory Postgres without Docker.
 */
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
`;

/**
 * Migrations marked "-- requires: vector" need pgvector, which PGlite doesn't
 * ship. They're skipped here and applied on Supabase; nothing later may depend on them.
 */
export const VECTOR_MARKER = "-- requires: vector";

export function needsVector(file: string): boolean {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8").startsWith(VECTOR_MARKER);
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function createMigratedDatabase(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_SHIM);
  for (const file of migrationFiles()) {
    if (needsVector(file)) continue;
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration failed: ${file}: ${(error as Error).message}`, { cause: error });
    }
  }
  return db;
}
