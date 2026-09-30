import { describe, expect, it } from "vitest";
import { hashPassword, hmacHex, randomToken, sha256Hex, verifyPassword } from "@/lib/security/crypto";
import { loginSchema, newPasswordSchema, resetPasswordSchema } from "@/modules/auth/auth.validation";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("correct horse 42 battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse 42 battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same-password-123")).not.toBe(await hashPassword("same-password-123"));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "plain-text")).toBe(false);
    expect(await verifyPassword("x", "md5$abc")).toBe(false);
  });
});

describe("tokens", () => {
  it("are long and unique", () => {
    const a = randomToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).not.toBe(randomToken());
  });

  it("hashes are deterministic hex", () => {
    expect(sha256Hex("x")).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacHex("x", "k")).not.toBe(hmacHex("x", "k2"));
  });
});

describe("auth validation", () => {
  it("normalizes email at login", () => {
    expect(loginSchema.parse({ email: "  Staff@Example.COM ", password: "p" }).email).toBe("staff@example.com");
  });

  it("enforces password strength for new passwords", () => {
    expect(newPasswordSchema.safeParse("short1").success).toBe(false);
    expect(newPasswordSchema.safeParse("alllettersnodigits").success).toBe(false);
    expect(newPasswordSchema.safeParse("long-enough-pass-1").success).toBe(true);
  });

  it("requires matching confirmation on reset", () => {
    const r = resetPasswordSchema.safeParse({ token: "t".repeat(43), password: "long-enough-pass-1", confirmPassword: "different-1" });
    expect(r.success).toBe(false);
  });
});
