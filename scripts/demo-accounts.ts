/**
 * Creates (or resets) the three shared demo logins: Administrator, Insurer Reviewer, Hospital Staff.
 *
 *   npm run demo:accounts [-- --hospital "Hospital name"] [-- --insurer "Insurer name"]
 *
 * Emails are admin@claimix.com, insurer@claimix.com and hospital@claimix.com. Passwords are read from
 * DEMO_ADMIN_PASSWORD, DEMO_INSURER_PASSWORD and DEMO_HOSPITAL_PASSWORD in .env.local (never from the
 * source), hashed, and never printed. Without --hospital / --insurer, the first active one by name is used.
 * Refuses to run in production: shared demo passwords don't belong on a live system.
 */
import { config } from "dotenv";
import { parseArgs } from "node:util";
import { createDb } from "@/db/client";
import { configureDemoAccounts } from "@/modules/users/demo-accounts";

config({ path: ".env.local" });

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Demo accounts are not created in production.");
    process.exit(1);
  }
  const { values } = parseArgs({ options: { hospital: { type: "string" }, insurer: { type: "string" } } });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }
  const { db, close } = createDb(url, { max: 1 });
  try {
    const results = await db.transaction((tx) =>
      configureDemoAccounts(
        tx,
        {
          admin: process.env.DEMO_ADMIN_PASSWORD ?? "",
          insurer: process.env.DEMO_INSURER_PASSWORD ?? "",
          hospital: process.env.DEMO_HOSPITAL_PASSWORD ?? "",
        },
        values,
      ),
    );
    for (const r of results) process.stdout.write(`${r.status === "created" ? "Created" : "Updated"} ${r.email} (${r.organization})\n`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

void main();
