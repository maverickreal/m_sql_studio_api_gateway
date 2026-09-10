import { Router } from "express";
import get_leaderboard from "../../../../controllers/leaderboard";

const router = Router();

router.get("/", get_leaderboard);

export default router;