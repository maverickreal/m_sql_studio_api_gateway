import Router from "express";
import {
  cleanup_assignment,
  confirm_assignment,
  get_old_schemas,
  trigger_cleanup,
} from "../../controllers/internal/";
import { reqHeadIntApiKeyValidMware, validateObjectId } from "../../middleware";
import { envVars } from "../../config";
import { ENV_MODE } from "../../utils";

const router = Router();

router.use(reqHeadIntApiKeyValidMware);

router.get("/cleanup/old-schemas", get_old_schemas);
router.post("/cleanup/:id", validateObjectId("id"), cleanup_assignment);
router.patch("/confirm/:id", validateObjectId("id"), confirm_assignment);

if (envVars.ENV_MODE === ENV_MODE.DEV) {
  router.post("/cleanup/trigger", trigger_cleanup);
}

export default router;
