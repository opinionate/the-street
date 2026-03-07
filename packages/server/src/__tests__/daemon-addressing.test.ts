import { describe, it, expect } from "vitest";

/**
 * Tests for daemon chat addressing logic.
 *
 * Bug: When a player addressed a daemon by name (e.g., "Hey Crash, how are you?"),
 * other daemons in the iteration loop could still trigger overhear reactions before
 * the named daemon was reached. The `break` at the end of the name-mention branch
 * only stopped daemons AFTER the named one in Map iteration order.
 *
 * Fix: Pre-scan the message for daemon name mentions. If a name is found,
 * skip all other daemons in the loop via `addressedDaemonId` filter.
 */

interface MockDaemon {
  id: string;
  name: string;
  isMuted: boolean;
}

function findAddressedDaemon(
  contentLower: string,
  daemons: MockDaemon[],
): string | null {
  for (const daemon of daemons) {
    if (contentLower.includes(daemon.name.toLowerCase())) {
      return daemon.id;
    }
  }
  return null;
}

function getDaemonsThatWouldReact(
  content: string,
  daemons: MockDaemon[],
): string[] {
  const contentLower = content.toLowerCase();
  const addressedDaemonId = findAddressedDaemon(contentLower, daemons);

  const reacting: string[] = [];
  for (const daemon of daemons) {
    if (daemon.isMuted) continue;

    // If the message addresses a specific daemon by name, skip all others
    if (addressedDaemonId && daemon.id !== addressedDaemonId) continue;

    reacting.push(daemon.id);
  }
  return reacting;
}

const DAEMONS: MockDaemon[] = [
  { id: "vinny-id", name: "Vinny Marzullo", isMuted: false },
  { id: "crash-id", name: "Crash", isMuted: false },
  { id: "cass-id", name: "Cass Verdant", isMuted: false },
  { id: "clevius-id", name: "Clevius", isMuted: false },
];

describe("daemon chat addressing", () => {
  it("only the named daemon reacts when addressed by name", () => {
    const result = getDaemonsThatWouldReact("Hey Crash, what's up?", DAEMONS);
    expect(result).toEqual(["crash-id"]);
  });

  it("handles case-insensitive name matching", () => {
    const result = getDaemonsThatWouldReact("hey crash, what's up?", DAEMONS);
    expect(result).toEqual(["crash-id"]);
  });

  it("handles multi-word daemon names", () => {
    const result = getDaemonsThatWouldReact("Vinny Marzullo, come here!", DAEMONS);
    expect(result).toEqual(["vinny-id"]);
  });

  it("all unmuted daemons can react when no name is mentioned", () => {
    const result = getDaemonsThatWouldReact("Hello everyone!", DAEMONS);
    expect(result).toHaveLength(4);
    expect(result).toContain("vinny-id");
    expect(result).toContain("crash-id");
    expect(result).toContain("cass-id");
    expect(result).toContain("clevius-id");
  });

  it("muted daemons never react", () => {
    const daemons: MockDaemon[] = [
      { id: "a", name: "Alpha", isMuted: true },
      { id: "b", name: "Beta", isMuted: false },
    ];
    const result = getDaemonsThatWouldReact("Hey Alpha!", daemons);
    // Alpha is addressed but muted — should not react
    expect(result).toEqual([]);
  });

  it("first match wins when message contains multiple daemon names", () => {
    const result = getDaemonsThatWouldReact(
      "Hey Crash, have you seen Cass Verdant?",
      DAEMONS,
    );
    // Crash appears first in the daemon list, so only Crash reacts
    expect(result).toEqual(["crash-id"]);
  });
});
