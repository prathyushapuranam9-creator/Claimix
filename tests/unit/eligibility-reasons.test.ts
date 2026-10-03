import { describe, expect, it } from "vitest";
import { failureReasons } from "@/modules/eligibility/eligibility.sections";
import type { RuleResult } from "@/modules/rules/engine/types";

const GENERIC = "Additional verification required: some information needed for this check is missing.";
const rule = (over: Partial<RuleResult>): RuleResult => ({
  code: "R",
  title: "Rule",
  category: "eligibility",
  kind: "system",
  outcome: "NEEDS_VERIFICATION",
  message: GENERIC,
  missing: [],
  applicable: true,
  ...over,
});

describe("eligibility failure reasons", () => {
  it("rules sharing the same generic message give distinct, labelled lines (the profile renders them as keyed items)", () => {
    const reasons = failureReasons([
      rule({ code: "A", title: "Waiting period" }),
      rule({ code: "B", title: "Pre-existing disease" }),
      rule({ code: "C", title: "Room rent limit" }),
    ]);
    expect(reasons).toEqual([`Waiting period: ${GENERIC}`, `Pre-existing disease: ${GENERIC}`, `Room rent limit: ${GENERIC}`]);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("drops exact repeats and leaves out passed or non-applicable rules", () => {
    const reasons = failureReasons([
      rule({ code: "A", title: "Waiting period" }),
      rule({ code: "A2", title: "Waiting period" }),
      rule({ code: "P", title: "Cover active", outcome: "PASS", message: "In force." }),
      rule({ code: "N", title: "Maternity", applicable: false }),
      rule({ code: "F", title: "Exclusion", outcome: "FAIL", message: "Excluded treatment." }),
    ]);
    expect(reasons).toEqual([`Waiting period: ${GENERIC}`, "Exclusion: Excluded treatment."]);
  });
});
