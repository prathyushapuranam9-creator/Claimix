import type { Db } from "@/db/client";
import { setupSystem } from "@/db/setup";
import { seedCore } from "./core";
import { seedNetwork } from "./network";
import { seedPolicies } from "./policies";
import { seedScheduling } from "./scheduling";

/**
 * TEST FIXTURES ONLY. Fictional organizations, users, patients and policies used by the
 * integration and E2E suites, loaded only into their dedicated test databases
 * (TEST_DATABASE_URL / E2E_DATABASE_URL). The application never loads this data.
 */
export interface SeedOptions {
  /** Re-hash fixture users with the run's password. */
  resetDemoPasswords?: boolean;
  /** Restore fixture coverage balances used up by earlier runs. */
  resetDemoBalances?: boolean;
}

export async function seed(db: Db, demoPassword: string, opts: SeedOptions = {}) {
  await db.transaction(async (tx) => {
    const roleIds = await setupSystem(tx);
    await seedCore(tx, roleIds, demoPassword, opts);
    await seedNetwork(tx);
    await seedPolicies(tx, opts);
    await seedScheduling(tx, opts);
  });
}
