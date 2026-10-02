import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";
import { parseEnv } from "@/lib/config/env";
import { NAV_ITEMS } from "@/lib/navigation";
import { accessRequestSchema } from "@/modules/access-requests/access-requests.validation";
import { ARTICLES, article } from "@/modules/knowledge/articles";
import { GLOSSARY, searchGlossary } from "@/modules/knowledge/glossary";
import { parsePublicPayer } from "@/modules/public/public-network.service";
import { fillMonths, formatHours, monthLabel, presetRange } from "@/modules/reports/format";

describe("knowledge content", () => {
  it("has 16 articles with unique slugs, and related terms that exist in the glossary", () => {
    expect(ARTICLES).toHaveLength(16);
    expect(new Set(ARTICLES.map((a) => a.slug)).size).toBe(16);
    const terms = new Set(GLOSSARY.map((g) => g.slug));
    for (const a of ARTICLES) for (const r of a.related ?? []) expect(terms, `${a.slug} → ${r}`).toContain(r);
    expect(article("how-cashless-works")?.title).toBe("How cashless insurance works");
    expect(article("nope")).toBeUndefined();
  });

  it("every glossary term has a simple explanation, an example and why it matters", () => {
    expect(new Set(GLOSSARY.map((g) => g.slug)).size).toBe(GLOSSARY.length);
    for (const g of GLOSSARY) for (const f of [g.term, g.simple, g.example, g.why]) expect(f.trim().length).toBeGreaterThan(1);
  });

  it("never describes ABDM as insurance or promises approval", () => {
    const text = JSON.stringify([ARTICLES, GLOSSARY]).toLowerCase();
    expect(text).toContain("not an insurance scheme");
    expect(text).not.toMatch(/guaranteed (approval|payment)|will be approved/);
  });

  it("glossary search is case-insensitive, term matches first, blank lists all alphabetically", () => {
    expect(searchGlossary("CO-PAY")[0]?.slug).toBe("co-pay");
    expect(searchGlossary("zzzz")).toEqual([]);
    const all = searchGlossary("  ");
    expect(all).toHaveLength(GLOSSARY.length);
    expect(all.map((t) => t.term)).toEqual([...all.map((t) => t.term)].sort((a, b) => a.localeCompare(b)));
    const hits = searchGlossary("sum insured");
    expect(hits[0]?.slug).toBe("sum-insured");
  });
});

describe("public network payer parsing", () => {
  it("accepts only insurer:/scheme: with a UUID", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(parsePublicPayer(`insurer:${id}`)).toEqual({ kind: "insurer", id });
    expect(parsePublicPayer(`scheme:${id}`)).toEqual({ kind: "scheme", id });
    for (const bad of [undefined, "", `tpa:${id}`, "insurer:1 or 1=1", `insurer:${id}x`, id]) expect(parsePublicPayer(bad)).toBeUndefined();
  });
});

describe("access request validation", () => {
  const ok = { fullName: "Asha Rao", email: " Asha@Example.TEST ", organizationName: "City Hospital 2", organizationType: "tpa" };
  it("normalizes email and accepts optional fields blank", () => {
    const r = accessRequestSchema.parse({ ...ok, jobTitle: "", phone: "", message: "" });
    expect(r.email).toBe("asha@example.test");
    expect(r.jobTitle).toBeUndefined();
  });
  it("rejects unknown organization types, markup in names and oversize messages", () => {
    expect(accessRequestSchema.safeParse({ ...ok, organizationType: "platform" }).success).toBe(false);
    expect(accessRequestSchema.safeParse({ ...ok, fullName: "<script>" }).success).toBe(false);
    expect(accessRequestSchema.safeParse({ ...ok, organizationName: "<b>x</b>" }).success).toBe(false);
    expect(accessRequestSchema.safeParse({ ...ok, message: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("report formatting", () => {
  it("labels months and fills gaps with zeros", () => {
    expect(monthLabel("2026-03")).toBe("Mar 2026");
    const filled = fillMonths([{ month: "2025-11", n: 1 }, { month: "2026-02", n: 4 }], (month) => ({ month, n: 0 }));
    expect(filled).toEqual([
      { month: "2025-11", n: 1 },
      { month: "2025-12", n: 0 },
      { month: "2026-01", n: 0 },
      { month: "2026-02", n: 4 },
    ]);
  });

  it("formats turnaround hours", () => {
    expect(formatHours(null)).toBe("—");
    expect(formatHours(0.001)).toBe("< 1 min");
    expect(formatHours(0.5)).toBe("30 min");
    expect(formatHours(5.25)).toBe("5.3 h");
    expect(formatHours(30)).toBe("30 h");
    expect(formatHours(72)).toBe("3.0 days");
  });

  it("builds inclusive preset ranges", () => {
    const today = new Date("2026-09-30T10:00:00Z");
    expect(presetRange("30d", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("12m", today)).toEqual({ from: "2025-09-30", to: "2026-09-30" });
    expect(presetRange("all", today)).toEqual({});
  });
});

describe("csv", () => {
  it("quotes fields and neutralizes formulas", () => {
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell(null)).toBe('""');
  });
});

describe("navigation", () => {
  it("exposes reports, knowledge and access requests behind the right permissions", () => {
    const by = Object.fromEntries(NAV_ITEMS.map((n) => [n.href, n.permission]));
    expect(by["/reports"]).toBe("report:view");
    expect(by["/admin/access-requests"]).toBe("user:manage");
    expect(by["/knowledge"]).toBe("dashboard:view");
  });
});

describe("production configuration guard", () => {
  const base = { NODE_ENV: "production", DATABASE_URL: "postgres://x@db/claimix", SESSION_SECRET: "k".repeat(48), APP_URL: "https://claims.example.in" };
  const issues = (over: Record<string, string>) => {
    const r = parseEnv({ ...base, ...over });
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };
  it("accepts a sound production config", () => expect(issues({})).toEqual([]));
  it("rejects the example secret, the unimplemented S3 driver and plain-http public URLs", () => {
    expect(issues({ SESSION_SECRET: "change-me-to-a-long-random-string-at-least-32-chars" })).toContain("SESSION_SECRET");
    expect(issues({ STORAGE_DRIVER: "s3" })).toContain("STORAGE_DRIVER");
    expect(issues({ APP_URL: "http://claims.example.in" })).toContain("APP_URL");
    expect(issues({ APP_URL: "http://localhost:3000" })).toEqual([]);
  });
  it("does not apply production rules in development", () => {
    expect(parseEnv({ ...base, NODE_ENV: "development", STORAGE_DRIVER: "s3", APP_URL: "http://x.test" }).success).toBe(true);
  });
});

describe("performance chart helpers", () => {
  it("formats compact rupee ticks and converts hours to days", async () => {
    const { compactINR, hoursToDays } = await import("@/modules/reports/format");
    expect(compactINR(0)).toBe("₹0");
    expect(compactINR(950)).toBe("₹950");
    expect(compactINR(12_000)).toBe("₹12K");
    expect(compactINR(1_250_000)).toBe("₹12.5L");
    expect(compactINR(37_500_000)).toBe("₹3.8Cr");
    expect(hoursToDays(null)).toBeNull();
    expect(hoursToDays(57.6)).toBe(2.4);
    expect(hoursToDays(0.01)).toBe(0);
  });
});
