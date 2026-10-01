/**
 * Creates an administrator account — the way into a fresh, empty installation.
 *
 *   npm run admin:create -- --email you@example.org --name "Your Name" [--org "Organization name"]
 *
 * The account gets an unusable random password and a one-time setup link (72 h) that is
 * printed once here and queued as an email. Passwords are never typed, shown or stored in clear.
 */
import { config } from "dotenv";
import { parseArgs } from "node:util";
import { createDb } from "@/db/client";
import { ValidationError } from "@/lib/errors";
import { createAdministrator } from "@/modules/users/create-admin";

config({ path: ".env.local" });

const USAGE = 'Usage: npm run admin:create -- --email you@example.org --name "Your Name" [--org "Organization name"]';

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, org: { type: "string" } } });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }
  const { db, close } = createDb(url, { max: 1 });
  try {
    const result = await createAdministrator(db, values, process.env.APP_URL ?? "http://localhost:3000");
    // Operator-facing CLI output (stdout), shown once; never written to logs.
    process.stdout.write(
      [`Administrator ${values.email} created.`, `Open this one-time link to set the password (valid ${result.expiresInHours} hours):`, result.link, ""].join("\n"),
    );
  } catch (e) {
    if (e instanceof ValidationError) {
      console.error(USAGE);
      for (const [field, messages] of Object.entries(e.fieldErrors ?? {})) console.error(`  --${field}: ${messages[0]}`);
    } else {
      console.error(e instanceof Error ? e.message : e);
    }
    process.exitCode = 1;
  } finally {
    await close();
  }
}

void main();
