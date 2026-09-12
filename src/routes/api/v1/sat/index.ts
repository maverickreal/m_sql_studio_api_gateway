import { Router } from "express";
import { requireAuthMware } from "../../../../middleware/";
import { getHintHealth } from "../../../../services/ai_hint";
import { logger } from "../../../../config";

const router = Router();

router.get("/hints/health", requireAuthMware, async (_req, res) => {
  try {
    const health = await getHintHealth();
    res.json(health);
  } catch (err) {
    logger.error({ err }, "Failed to get hint stack health");
    res.status(500).json({ error: "Failed to get hint health" });
  }
});

export default router;
