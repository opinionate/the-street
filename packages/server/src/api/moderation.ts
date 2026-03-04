import { Router } from "express";
import { getPool } from "../database/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const router = Router();

// POST /api/moderation/action — platform operator moderation
router.post("/action", ...requireAuth(), async (req, res) => {
  const authedReq = req as AuthedRequest;
  try {
    const { targetType, targetId, action, reasoning } = req.body;

    // Validate inputs
    const validTypes = ["user", "plot", "object"];
    const validActions = [
      "warn",
      "remove_object",
      "suspend_user",
      "remove_plot",
    ];

    if (!validTypes.includes(targetType)) {
      res
        .status(400)
        .json({ error: `targetType must be one of: ${validTypes.join(", ")}` });
      return;
    }
    if (!validActions.includes(action)) {
      res
        .status(400)
        .json({ error: `action must be one of: ${validActions.join(", ")}` });
      return;
    }
    if (!targetId || !reasoning) {
      res
        .status(400)
        .json({ error: "targetId and reasoning required" });
      return;
    }

    // TODO: V1 — verify moderator role (for now, any authenticated user)
    // In production, check against a moderators table or Clerk role

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO moderation_log (moderator_id, target_type, target_id, action, reasoning)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [authedReq.userId, targetType, targetId, action, reasoning],
    );

    res.json({ success: true, actionId: rows[0].id });
  } catch (err) {
    console.error("POST /api/moderation/action error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
