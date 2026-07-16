/**
 * Least-privilege DB-role verification (Phase 10 Slice 5, ADR-0027).
 * Extends the Phase 5 RLS gate proof (test/clinical/rls.test.ts) into a
 * permanent, runnable check usable against any environment, production
 * included (read-only: every probe either reads catalogs or is expected
 * to be DENIED; the one DDL probe cleans up after itself in the failure
 * case where it unexpectedly succeeds).
 *
 * Usage:
 *   pnpm --filter @mesomed/api verify:db-role
 *     — connects with DATABASE_URL as-is (production shape: the app
 *       role's own credentials; current_user IS the app role)
 *   pnpm --filter @mesomed/api verify:db-role -- --set-role mesomed_api
 *     — owner/CI shape: SET ROLE first (needs membership/superuser)
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */
import pg from "pg";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const CLINICAL_RLS_TABLES = ["encounters", "visit_notes", "prescriptions"];

async function denied(client: pg.Client, statement: string): Promise<string | null> {
  try {
    await client.query(statement);
    return null; // statement succeeded — NOT denied
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission denied/i.test(message)) return message;
    return message; // denied for another reason — caller decides
  }
}

export async function verifyDbRole(
  connectionString: string,
  options: { setRole?: string } = {},
): Promise<CheckResult[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const results: CheckResult[] = [];
  const check = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

  try {
    if (options.setRole) {
      await client.query(`set role ${pg.escapeIdentifier(options.setRole)}`);
    }

    const who = await client.query<{ current_user: string }>("select current_user");
    const roleName = who.rows[0]!.current_user;

    // 1. Role attributes: no superuser, no createdb/createrole/bypassrls.
    const attrs = await client.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
    }>(
      "select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = current_user",
    );
    const a = attrs.rows[0]!;
    check(
      "role has no superuser/createdb/createrole/bypassrls",
      !a.rolsuper && !a.rolcreatedb && !a.rolcreaterole && !a.rolbypassrls,
      `${roleName}: super=${a.rolsuper} createdb=${a.rolcreatedb} createrole=${a.rolcreaterole} bypassrls=${a.rolbypassrls}`,
    );

    // 2. Role does not own the clinical tables (owner bypasses RLS with
    // no policies? No — owner bypasses nothing here, but owner can ALTER;
    // least-privilege means the app role owns nothing).
    const owners = await client.query<{ tablename: string; tableowner: string }>(
      "select tablename, tableowner from pg_tables where schemaname = 'public'",
    );
    const owned = owners.rows.filter((r) => r.tableowner === roleName).map((r) => r.tablename);
    check(
      "role owns no tables",
      owned.length === 0,
      owned.length === 0 ? "owns nothing in public" : `owns: ${owned.join(", ")}`,
    );

    // 3. DDL is denied.
    const ddl = await denied(client, "create table _mm_verify_ddl_probe (id int)");
    if (ddl === null) {
      await client.query("drop table _mm_verify_ddl_probe");
      check("DDL (create table) denied", false, "create table SUCCEEDED (probe dropped)");
    } else {
      check("DDL (create table) denied", /permission denied/i.test(ddl), ddl.slice(0, 120));
    }

    // 4. clinical_access_log is append-only-by-privilege for this role:
    // INSERT (trigger-only path), UPDATE and DELETE all denied.
    for (const statement of [
      "insert into clinical_access_log (actor_user_id, action) values ('verify-probe', 'notes_read')",
      "update clinical_access_log set actor_user_id = 'verify-probe'",
      "delete from clinical_access_log",
    ]) {
      const verb = statement.split(" ")[0]!.toUpperCase();
      const result = await denied(client, statement);
      check(
        `clinical_access_log ${verb} denied`,
        result !== null && /permission denied/i.test(result),
        result === null ? `${verb} SUCCEEDED` : result.slice(0, 120),
      );
    }

    // 5. Clinical-tier direct SELECT denied (convention #6 exception tier).
    for (const table of CLINICAL_RLS_TABLES) {
      const result = await denied(client, `select * from ${table} limit 1`);
      check(
        `direct SELECT on ${table} denied`,
        result !== null && /permission denied/i.test(result),
        result === null ? "SELECT SUCCEEDED" : result.slice(0, 120),
      );
    }

    // 6. RLS enabled on exactly the clinical tier, with zero policies
    // (deny-all posture, ADR-0010).
    const rls = await client.query<{ relname: string }>(
      `select relname from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
       order by relname`,
    );
    const rlsTables = rls.rows.map((r) => r.relname);
    check(
      "RLS enabled on exactly encounters/prescriptions/visit_notes",
      JSON.stringify(rlsTables) === JSON.stringify([...CLINICAL_RLS_TABLES].sort()),
      rlsTables.join(", ") || "(none)",
    );
    const policies = await client.query("select polname from pg_policy");
    check(
      "zero RLS policies (deny-all)",
      policies.rows.length === 0,
      `${policies.rows.length} policies`,
    );

    // 7. The SECURITY DEFINER channel is the working path for this role.
    const channel = await client.query<{ ok: boolean }>(
      `select has_function_privilege(current_user, 'clinical_read_visit_notes(text, uuid)', 'execute') as ok`,
    );
    check(
      "SECURITY DEFINER channel executable",
      channel.rows[0]!.ok,
      `clinical_read_visit_notes execute=${channel.rows[0]!.ok}`,
    );

    return results;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1]?.endsWith("verify-db-role.ts");
if (isMain) {
  const setRoleIndex = process.argv.indexOf("--set-role");
  const setRole = setRoleIndex === -1 ? undefined : process.argv[setRoleIndex + 1];
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  const results = await verifyDbRole(connectionString, { setRole });
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} — ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? "\nAll checks passed." : `\n${failed.length} check(s) FAILED.`);
  process.exit(failed.length === 0 ? 0 : 1);
}
