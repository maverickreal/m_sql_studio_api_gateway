import { Router } from "express";
import {
  run_client_sql_code,
  get_job_status,
  stream_job_status,
} from "../../../../../controllers";
import {
  ExecuteRateLimitMware,
  requireAuthMware,
} from "../../../../../middleware/";

const router = Router();

router.post(
  "/execute",
  requireAuthMware,
  ExecuteRateLimitMware,
  run_client_sql_code,
);
router.get("/status/:taskId", requireAuthMware, get_job_status);
router.get("/status/:taskId/stream", requireAuthMware, stream_job_status);

export default router;
