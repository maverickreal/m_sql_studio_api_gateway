import { Router } from "express";
import assignmentRouter from "./assignments";
import adminRouter from "./admin";
import profileRouter from "./profile";
import leaderboardRouter from "./leaderboard";

const router = Router();

router.use("/assignments", assignmentRouter);
router.use("/admin", adminRouter);
router.use("/profile", profileRouter);
router.use("/leaderboard", leaderboardRouter);

export default router;
