import Router from "express";
import {
  create_assignment,
  list_assignments,
  list_users,
  set_user_role,
  list_audit,
} from "../../../../controllers/";
import { requireAuthMware, requireAdminMware } from "../../../../middleware/";

const router = Router();

router.use(requireAuthMware);
router.use(requireAdminMware);

router.post("/assignments", create_assignment);
router.get("/assignments", list_assignments);
router.get("/users", list_users);
router.post("/users/:id/role", set_user_role);
router.get("/audit", list_audit);

export default router;
