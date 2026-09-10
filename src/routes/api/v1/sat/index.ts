import { Router } from "express";
import { requireAuthMware } from "../../../../middleware/";
import { getHintStack } from "../../../../services/hint_stack";
import { logger } from "../../../../config";

const router = Router();

router.get("/hints/health", requireAuthMware, async (_req, res) => {
  try {
    const stack = getHintStack();
    if (!stack) {
      res.json({ ollama: "down", gemini: "unconfigured", enabled: false });
      return;
    }
    const health = await stack.getHealth();
    res.json({ ...health, enabled: true });
  } catch (err) {
    logger.error({ err }, "Failed to get hint stack health");
    res.status(500).json({ error: "Failed to get hint health" });
  }
});

export default router;
