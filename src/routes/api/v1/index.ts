import { Router } from "express";
import assignmentRouter from "./assignments";
import adminRouter from "./admin";
import profileRouter from "./profile";

const router = Router();

router.use("/assignments", assignmentRouter);
router.use("/admin", adminRouter);
router.use("/profile", profileRouter);

export default router;
