import { Request, Response } from "express";
import { z } from "zod/v4";
import { UserProfile, ProfileUpdateValidatorSchema } from "../../data/db/models/user_profile";

const get_my_profile = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const profile = await UserProfile.findOne({ userId }).lean();
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.status(200).json({ profile: serializeProfile(profile, true) });
};

const update_my_profile = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const parsed = z.object(ProfileUpdateValidatorSchema).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const update = parsed.data;
  if (update.displayName) {
    const existing = await UserProfile.findOne({
      displayName: update.displayName,
      userId: { $ne: userId },
    }).lean();
    if (existing) {
      res.status(409).json({ error: "Display name already taken" });
      return;
    }
  }
  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.status(200).json({ profile: serializeProfile(profile, true) });
};

const get_public_profile = async (req: Request, res: Response) => {
  const targetId = req.params.id;
  const profile = await UserProfile.findOne({ userId: targetId }).lean();
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  if (!profile.preferences?.publicProfile && req.user?.id !== targetId && req.user?.role !== "admin") {
    res.status(404).json({ error: "Profile not found" }); // don't leak existence
    return;
  }
  const isOwnerOrAdmin = req.user?.id === targetId || req.user?.role === "admin";
  res.status(200).json({ profile: serializeProfile(profile, isOwnerOrAdmin) });
};

function serializeProfile(doc: any, includePrivate: boolean) {
  const base = {
    userId: String(doc.userId),
    displayName: doc.displayName,
    bio: doc.bio,
    avatarUrl: doc.avatarUrl,
    stats: doc.stats,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
  if (includePrivate) {
    return { ...base, preferences: doc.preferences };
  }
  return base;
}

export { get_my_profile, update_my_profile, get_public_profile };