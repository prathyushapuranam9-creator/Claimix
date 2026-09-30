import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { AuditService } from "@/modules/audit/audit.service";
import { testContext } from "./helpers";

const ctx = testContext();
afterAll(() => ctx.close());

describe("audit log", () => {
  it("records events with request metadata", async () => {
    const rid = `req-${Date.now()}`;
    await AuditService.record(ctx.db, { action: "test.event", resourceType: "test", resourceId: "1", newState: { a: 1 }, meta: { ipAddress: "203.0.113.5", userAgent: "ua", requestId: rid } });
    const [row] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.requestId, rid));
    expect(row?.action).toBe("test.event");
    expect(row?.ipAddress).toBe("203.0.113.5");
  });

  it("drops invalid IP values instead of failing", async () => {
    const rid = `req-bad-ip-${Date.now()}`;
    await AuditService.record(ctx.db, { action: "test.event", meta: { ipAddress: "<script>", requestId: rid } });
    const [row] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.requestId, rid));
    expect(row?.ipAddress).toBeNull();
  });

  it("is append-only: UPDATE, DELETE and TRUNCATE are rejected by the database", async () => {
    await expect(ctx.db.execute(sql`update audit_logs set action = 'tampered'`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`delete from audit_logs`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`truncate audit_logs`)).rejects.toThrow();
  });

  it("rolls back with the business transaction it belongs to", async () => {
    const rid = `req-rollback-${Date.now()}`;
    await ctx.db
      .transaction(async (tx) => {
        await AuditService.record(tx, { action: "test.rolled_back", meta: { requestId: rid } });
        throw new Error("business failure");
      })
      .catch(() => {});
    const rows = await ctx.db.select().from(auditLogs).where(eq(auditLogs.requestId, rid));
    expect(rows).toHaveLength(0);
  });
});
