import { describe, it, expect } from "vitest";

/**
 * Tests for the UUID validation logic used in handleObjectRemove.
 *
 * Bug: Client sent synthetic plot object IDs like "plot_92bbaa1a-..._0"
 * to the server, which used them directly in a PostgreSQL UUID column query,
 * causing "invalid input syntax for type uuid" and crashing the server.
 *
 * Fix: Validate objectId is a proper UUID before querying.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("object removal UUID validation", () => {
  it("accepts a valid UUID", () => {
    expect(UUID_REGEX.test("ab1220ef-82d4-4feb-85d0-6d96aac6860d")).toBe(true);
    expect(UUID_REGEX.test("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(UUID_REGEX.test("D499A88F-38A4-4575-9E21-E32D0ED5123D")).toBe(true);
  });

  it("rejects synthetic plot_ prefixed IDs", () => {
    expect(UUID_REGEX.test("plot_92bbaa1a-2a94-45d4-988c-2abc56942a81_0")).toBe(false);
    expect(UUID_REGEX.test("plot_92bbaa1a-2a94-45d4-988c-2abc56942a81_1")).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(UUID_REGEX.test("")).toBe(false);
  });

  it("rejects partial UUIDs", () => {
    expect(UUID_REGEX.test("ab1220ef-82d4")).toBe(false);
    expect(UUID_REGEX.test("ab1220ef")).toBe(false);
  });

  it("rejects UUIDs with extra characters", () => {
    expect(UUID_REGEX.test("ab1220ef-82d4-4feb-85d0-6d96aac6860d-extra")).toBe(false);
    expect(UUID_REGEX.test("prefix-ab1220ef-82d4-4feb-85d0-6d96aac6860d")).toBe(false);
  });
});
