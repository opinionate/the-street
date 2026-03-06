import { describe, it, expect } from "vitest";
import { MSG, VALID_EMOTE_IDS, RATE_LIMITS } from "../protocol.js";
import type { ClientMessage, ServerMessage, EmoteId } from "../protocol.js";

describe("Protocol", () => {
  describe("VALID_EMOTE_IDS", () => {
    it("contains all 8 animated emotes", () => {
      expect(VALID_EMOTE_IDS).toHaveLength(8);
      expect(VALID_EMOTE_IDS).toContain("dance");
      expect(VALID_EMOTE_IDS).toContain("shrug");
      expect(VALID_EMOTE_IDS).toContain("nod");
      expect(VALID_EMOTE_IDS).toContain("cry");
      expect(VALID_EMOTE_IDS).toContain("wave");
      expect(VALID_EMOTE_IDS).toContain("bow");
      expect(VALID_EMOTE_IDS).toContain("cheer");
      expect(VALID_EMOTE_IDS).toContain("laugh");
    });

    it("EmoteId type matches array entries", () => {
      // Compile-time check: if this file compiles, types are consistent
      const emote: EmoteId = "dance";
      expect(VALID_EMOTE_IDS).toContain(emote);
    });
  });

  describe("MSG constants", () => {
    it("has all client message types", () => {
      // These MSG keys must correspond to ClientMessage.type values
      expect(MSG.MOVE).toBe("move");
      expect(MSG.INTERACT).toBe("interact");
      expect(MSG.CHAT).toBe("chat");
      expect(MSG.OBJECT_PLACE).toBe("object_place");
      expect(MSG.OBJECT_REMOVE).toBe("object_remove");
      expect(MSG.OBJECT_UPDATE_STATE).toBe("object_update_state");
      expect(MSG.DAEMON_INTERACT).toBe("daemon_interact");
      expect(MSG.DAEMON_RECALL).toBe("daemon_recall");
      expect(MSG.DAEMON_TOGGLE_ROAM).toBe("daemon_toggle_roam");
      expect(MSG.EMOTE).toBe("emote");
      expect(MSG.AVATAR_UPDATE).toBe("avatar_update");
    });

    it("has all server message types", () => {
      expect(MSG.PLAYER_JOIN).toBe("player_join");
      expect(MSG.PLAYER_LEAVE).toBe("player_leave");
      expect(MSG.PLAYER_MOVE).toBe("player_move");
      expect(MSG.OBJECT_STATE_CHANGE).toBe("object_state_change");
      expect(MSG.OBJECT_PLACED).toBe("object_placed");
      expect(MSG.OBJECT_REMOVED).toBe("object_removed");
      expect(MSG.WORLD_SNAPSHOT).toBe("world_snapshot");
      expect(MSG.PLAYER_AVATAR_UPDATE).toBe("player_avatar_update");
      expect(MSG.DAEMON_SPAWN).toBe("daemon_spawn");
      expect(MSG.DAEMON_DESPAWN).toBe("daemon_despawn");
      expect(MSG.DAEMON_MOVE).toBe("daemon_move");
      expect(MSG.DAEMON_CHAT).toBe("daemon_chat");
      expect(MSG.DAEMON_EMOTE).toBe("daemon_emote");
      expect(MSG.DAEMON_THOUGHT).toBe("daemon_thought");
      expect(MSG.PLAYER_EMOTE).toBe("player_emote");
    });

    it("has no duplicate values", () => {
      const values = Object.values(MSG);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });
  });

  describe("ClientMessage type completeness", () => {
    it("avatar_update message has correct shape", () => {
      // Type assertion test — ensures the type includes avatar_update
      const msg: ClientMessage = {
        type: "avatar_update",
        avatarDefinition: {
          avatarIndex: 0,
        },
      };
      expect(msg.type).toBe("avatar_update");
    });

    it("emote message uses EmoteId type (not plain string)", () => {
      // This compiles only if emoteId is EmoteId, not string
      const msg: ClientMessage = {
        type: "emote",
        emoteId: "dance",
      };
      expect(msg.type).toBe("emote");
      expect(VALID_EMOTE_IDS).toContain(msg.type === "emote" ? msg.emoteId : "");
    });
  });

  describe("ServerMessage type completeness", () => {
    it("world_snapshot includes yourUserId and yourRole", () => {
      const msg: ServerMessage = {
        type: "world_snapshot",
        yourUserId: "user-123",
        yourRole: "user",
        players: [],
        plots: [],
      };
      expect(msg.yourUserId).toBe("user-123");
      expect(msg.type === "world_snapshot" && msg.yourRole).toBe("user");
    });

    it("player_emote message has correct shape", () => {
      const msg: ServerMessage = {
        type: "player_emote",
        userId: "user-1",
        emoteId: "wave",
      };
      expect(msg.type).toBe("player_emote");
    });
  });

  describe("RATE_LIMITS", () => {
    it("has chat rate limit defined", () => {
      expect(RATE_LIMITS.chat.maxPerSecond).toBe(1);
    });

    it("has AI generation rate limit", () => {
      expect(RATE_LIMITS.aiGeneration.maxPerMinute).toBeGreaterThan(0);
    });

    it("has object placement rate limit", () => {
      expect(RATE_LIMITS.objectPlacement.maxPerMinute).toBeGreaterThan(0);
    });
  });
});
