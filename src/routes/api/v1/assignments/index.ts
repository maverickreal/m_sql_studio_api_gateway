import Router from "express";
import {
  retrieve_all_assignments,
  retrieve_assignment,
  get_last_sql,
  save_last_sql,
} from "../../../../controllers";
import clientSQLCodeRunRouter from "./execution";
import { requireAuthMware, validateObjectId } from "../../../../middleware/";

const router = Router();

router.use("/client-sql-code-run", clientSQLCodeRunRouter);

router.get("/", retrieve_all_assignments);
router.get("/:id", validateObjectId("id"), retrieve_assignment);
router.get(
  "/:id/last-sql",
  requireAuthMware,
  validateObjectId("id"),
  get_last_sql,
);
router.post(
  "/:id/last-sql",
  requireAuthMware,
  validateObjectId("id"),
  save_last_sql,
);

export default router;
