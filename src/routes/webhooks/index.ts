import { Router } from "express";
import { github_webhook } from "../../controllers/webhook";

const router = Router();

router.post("/github", github_webhook);

export default router;
