import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, passwordPolicyIssue } from "../lib/auth/password";
import { ROLE_DEFINITIONS } from "../lib/auth/rbac";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("CorrectHorse1");
    expect(verifyPassword("CorrectHorse1", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces distinct salts for identical passwords", () => {
    expect(hashPassword("SamePass123")).not.toBe(hashPassword("SamePass123"));
  });

  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("password policy", () => {
  it("enforces length, letter and digit", () => {
    expect(passwordPolicyIssue("short")).toMatch(/10 characters/);
    expect(passwordPolicyIssue("alllettersonly")).toMatch(/digit/);
    expect(passwordPolicyIssue("1234567890")).toMatch(/letter/);
    expect(passwordPolicyIssue("GoodPass123")).toBeNull();
  });
});

describe("role definitions", () => {
  it("admin role has every permission and viewer is read-only", () => {
    expect(ROLE_DEFINITIONS.admin.permissions).toContain("admin.users");
    expect(ROLE_DEFINITIONS.admin.permissions).toContain("bots.control");
    expect(ROLE_DEFINITIONS.viewer.permissions).toEqual(["market.read", "news.read", "research.read"]);
    expect(ROLE_DEFINITIONS.viewer.permissions).not.toContain("portfolio.trade");
  });
});