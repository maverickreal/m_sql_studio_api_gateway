import { Router } from "express";
import { get_my_profile, update_my_profile, get_public_profile } from "../../../../controllers/profile";
import { requireAuthMware, optionalAuthMware } from "../../../../middleware";

const router = Router();

// GET /api/v1/profile/me — owner only
router.get("/me", requireAuthMware, get_my_profile);

// PATCH /api/v1/profile/me — owner only
router.patch("/me", requireAuthMware, update_my_profile);

// GET /api/v1/profile/:id — public (optional auth)
router.get("/:id", optionalAuthMware, get_public_profile);

export default router;