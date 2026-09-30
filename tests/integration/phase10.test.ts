import { afterAll, describe, expect, it } from "vitest";
import { and, eq, gt } from "drizzle-orm";
import { jobs, passwordResetTokens } from "@/db/schema";
import { JobQueue } from "@/modules/jobs/job-queue";
import { SESSION_POLICY } from "@/modules/auth/auth.service";
import { createThrowawayUser, META, testContext } from "./helpers";

const ctx = testContext();
afterAll(() => ctx.close());

describe("password reset hardening", () => {
  it("caps reset links per account per hour and answers identically either way", async () => {
    const u = await createThrowawayUser(ctx.db, "Throwaway-password-123");
    const since = new Date(Date.now() - 1000);
    for (let i = 0; i < SESSION_POLICY.resetLimit.max + 2; i++) {
      await expect(ctx.auth.requestPasswordReset({ email: u.email }, META)).resolves.toBeUndefined();
    }
    const issued = await ctx.db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, u.id), gt(passwordResetTokens.createdAt, since)));
    expect(issued).toHaveLength(SESSION_POLICY.resetLimit.max);
  });

  it("takes about as long for unknown emails as for real ones", async () => {
    const t0 = Date.now();
    await ctx.auth.requestPasswordReset({ email: "nobody-here@test.claimix.invalid" }, META);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(SESSION_POLICY.resetMinMs - 5);
  });
});

describe("background jobs", () => {
  it("clears the payload (e.g. one-time links) when a job fails permanently", async () => {
    const id = await JobQueue.enqueue(ctx.db, "report.export", { link: "https://example.test/reset?token=secret" }, new Date("2000-01-01T00:00:00Z"));
    await ctx.db.update(jobs).set({ attempts: 4 }).where(eq(jobs.id, id));
    await JobQueue.runDue(ctx.db, { "report.export": async () => { throw new Error("smtp down"); } }, 1);
    const [row] = await ctx.db.select().from(jobs).where(eq(jobs.id, id));
    expect(row).toMatchObject({ status: "failed", attempts: 5, payload: {} });
  });
});
