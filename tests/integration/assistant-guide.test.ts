import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { guideChat } from "@/modules/assistant/guide";
import { extractIdentifiers, lookupIdentifiers } from "@/modules/assistant/lookup";
import { PreauthService } from "@/modules/preauth/preauth.service";
import { codes, freshFloaterPatient } from "./fixtures";
import { demoPrincipals, svc, testContext } from "./helpers";

/**
 * The assistant's view of the application: identifiers a user pastes are resolved through the same scoped services
 * as the screens, and the model (a local stand-in for OpenRouter here) only ever receives what that user may see.
 */
const ctx = testContext();
let who: Awaited<ReturnType<typeof demoPrincipals>>;
let server: Server;
let requests: { auth: string | undefined; body: { model: string; messages: { role: string; content: string }[] } }[] = [];
let respond: (res: import("node:http").ServerResponse) => void;
const as = (k: keyof typeof who) => svc(ctx.db, who[k]);

let patientNo: string;
let patientName: string;
let reference: string;
let preauthId: string;

beforeAll(async () => {
  who = await demoPrincipals(ctx.auth, ctx.demoPassword);
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      respond(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("OPENROUTER_BASE_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
  vi.stubEnv("OPENROUTER_MODEL", "test/model");
  vi.stubEnv("LLM_ASSISTANT_ENABLED", "true");

  const c = await codes(ctx.db);
  const { patient, coverage } = await freshFloaterPatient(ctx.db, who.staffA);
  patientNo = patient.patientNo;
  patientName = patient.fullName;
  const p = await PreauthService.create(as("staffA"), {
    beneficiaryId: coverage.id, claimType: "cashless", diagnosisId: c.dx.K35, procedureId: c.px.APPENDECTOMY, admissionDate: "2026-10-20",
    isAccident: "no", pedDeclared: "no", pedRelated: "unknown", estimatedCost: 90000, expectedInsuranceAmount: 90000, roomRentPerDay: 4000,
  });
  reference = p.reference;
  preauthId = p.id;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((r) => server.close(() => r()));
  await ctx.close();
});
afterEach(() => { requests = []; });

const ok = (text: string) => (res: import("node:http").ServerResponse) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
};
const status = (code: number) => (res: import("node:http").ServerResponse) => { res.writeHead(code); res.end("{}"); };

describe("identifiers", () => {
  it("recognises Claimix reference formats and record ids, and ignores ordinary text", () => {
    expect(extractIdentifiers("pt-abc12345 what this mean?").map((t) => t.token)).toEqual(["PT-ABC12345"]);
    expect(extractIdentifiers("see PA-20261005-AB12CD and CL-20261005-ZZ99XX").map((t) => t.kind)).toEqual(["preauth", "claim"]);
    expect(extractIdentifiers("claimed e-mail follow-up in 2026-10-05")).toEqual([]);
    expect(extractIdentifiers("3f2b8c1e-1111-4222-8333-444455556666")[0]).toMatchObject({ uuid: true });
  });
});

describe("authorized lookup", () => {
  it("hospital staff find their own patient number and pre-authorization reference", async () => {
    const r = await lookupIdentifiers(svc(ctx.db, who.staffA), `${patientNo} and ${reference}`);
    expect(r.found.map((f) => f.kind).sort()).toEqual(["patient", "preauth"]);
    expect(r.missing).toEqual([]);
    const pa = r.found.find((f) => f.kind === "preauth")!;
    expect(pa.facts.join("\n")).toContain("Status: Draft");
    // No personal details are carried in the facts.
    expect(JSON.stringify(r)).not.toContain(patientName);
  });

  it("another hospital, an unrelated insurer and a not-yet-submitted request are all 'not found'", async () => {
    for (const k of ["staffB", "insurerA", "insurerB"] as const) {
      const r = await lookupIdentifiers(svc(ctx.db, who[k]), `${patientNo} ${reference}`);
      expect(r.found, k).toEqual([]);
      expect(r.missing.length, k).toBe(2);
    }
  });

  it("a record id is checked the same way", async () => {
    expect((await lookupIdentifiers(as("staffA"), preauthId)).found[0]?.identifier).toBe(reference);
    expect((await lookupIdentifiers(as("staffB"), preauthId)).found).toEqual([]);
  });

  it("a nonexistent reference is reported as not found", async () => {
    const r = await lookupIdentifiers(as("staffA"), "PT-ZZZZ9999");
    expect(r).toMatchObject({ found: [], missing: [{ identifier: "PT-ZZZZ9999", kind: "patient" }] });
  });
});

describe("assistant conversation with the model", () => {
  it("sends the model the role context, recent requests and the found record, never personal details or other hospitals' data", async () => {
    respond = ok("That is a pre-authorization reference. It is a Draft.");
    const reply = await guideChat(as("staffA"), `${reference} what does this mean?`, []);
    expect(reply.source).toBe("model");
    expect(reply.markdown).toContain("pre-authorization reference");
    expect(reply.links.some((l) => l.href === `/pre-authorizations/${preauthId}`)).toBe(true);
    expect(reply.focus?.label).toBe(reference);

    expect(requests).toHaveLength(1);
    const sys = requests[0]!.body.messages[0]!.content;
    expect(requests[0]!.auth).toBe("Bearer sk-or-test-key");
    expect(requests[0]!.body.model).toBe("test/model");
    expect(sys).toContain("RECORDS FOUND");
    expect(sys).toContain(`${reference} [pre-authorization reference]`);
    expect(sys).toContain("Status: Draft");
    expect(sys).toContain("RECENT REQUESTS");
    expect(sys).toContain("Role: Hospital Staff");
    expect(sys).toContain("PRE-AUTHORIZATION STATUS CHANGES");
    expect(sys).not.toContain(patientName);
    expect(JSON.stringify(reply)).not.toContain("sk-or-test-key");
  });

  it("an identifier the user cannot access is described to the model only as NOT FOUND", async () => {
    respond = ok("I could not find that.");
    const reply = await guideChat(as("staffB"), `${reference}`, []);
    const sys = requests[0]!.body.messages[0]!.content;
    expect(sys).toContain("NOT FOUND");
    expect(sys).not.toContain("RECORDS FOUND (visible");
    expect(sys).not.toContain("Status: Draft");
    expect(reply.focus).toBeNull();
  });

  it("keeps the conversation: history and the focused record are carried into the next turn", async () => {
    respond = ok("Open the Documents card on that request.");
    const first = await guideChat(as("staffA"), `${reference}`, []);
    respond = ok("Upload the documents in the Documents card.");
    await guideChat(as("staffA"), "Where do I upload the required documents?", [{ role: "user", content: reference }, { role: "assistant", content: first.markdown }], { id: first.focus!.id });
    const sent = requests.at(-1)!.body.messages;
    expect(sent[0]!.content).toContain(`${reference} [pre-authorization reference]`); // re-resolved for this user
    expect(sent.some((m) => m.role === "user" && m.content === reference)).toBe(true);
    expect(sent.at(-1)).toEqual({ role: "user", content: "Where do I upload the required documents?" });
  });

  it("a focus id belonging to someone else's record gives the model nothing", async () => {
    respond = ok("Which request do you mean?");
    await guideChat(as("staffB"), "What should I do next?", [], { id: preauthId });
    expect(requests[0]!.body.messages[0]!.content).not.toContain("Status: Draft");
  });

  it("unrelated questions never reach the model", async () => {
    respond = ok("Mumbai Indians");
    const r = await guideChat(as("staffA"), "Who won the cricket match?", []);
    expect(r.markdown).toBe("I can help only with the Claimix application, its workflows, navigation, statuses, records, and available actions.");
    expect(requests).toHaveLength(0);
  });

  it("the model's own out-of-scope verdict becomes the short Claimix-only reply", async () => {
    respond = ok("OUT_OF_SCOPE");
    const r = await guideChat(as("staffA"), "Tell me about the Roman empire", []);
    expect(r.source).toBe("scope");
  });
});

describe("when the AI service fails", () => {
  it.each([[401, /rejected the configured API key/], [429, /rate limit/], [404, /unavailable/], [500, /returned an error/]])("HTTP %i gives a clear notice, and a found record is still explained from the application", async (code, notice) => {
    respond = status(code);
    const r = await guideChat(as("staffA"), `${reference} what is this?`, []);
    expect(r.notice).toMatch(notice);
    expect(r.markdown).toContain(`**${reference}** is a pre-authorization reference`);
    expect(r.markdown).toContain("Status: Draft");
    expect(JSON.stringify(r)).not.toContain("sk-or-test-key");
  });

  it("a missing key is reported as a configuration problem", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const r = await guideChat(as("staffA"), "Where can I find claims?", []);
    expect(r.notice).toMatch(/missing OpenRouter API key/);
    expect(r.markdown).toContain("Dashboard\n→ Claims needing action"); // still answered from the application's own navigation
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
  });

  it("an unreachable service is a network notice", async () => {
    vi.stubEnv("OPENROUTER_BASE_URL", "http://127.0.0.1:1");
    const r = await guideChat(as("staffA"), "Where can I find claims?", []);
    expect(r.notice).toMatch(/Could not reach the AI service/);
    vi.stubEnv("OPENROUTER_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  });
});
