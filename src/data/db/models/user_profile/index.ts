import { Schema, InferSchemaType, Model, model } from "mongoose";
import { z } from "zod/v4";

const UserProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "user", required: true, unique: true },
    displayName: { type: String, required: true, minLength: 1, maxLength: 50 },
    bio: { type: String, required: false, maxLength: 500, default: "" },
    avatarUrl: { type: String, required: false, default: null },
    preferences: {
      theme: { type: String, enum: ["system", "light", "dark"], default: "system" },
      emailNotifications: { type: Boolean, default: true },
      publicProfile: { type: Boolean, default: true },
    },
    stats: {
      assignmentsCompleted: { type: Number, default: 0 },
      totalExecutions: { type: Number, default: 0 },
      lastActiveAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

UserProfileSchema.index(
  { displayName: 1 },
  { unique: true, partialFilterExpression: { displayName: { $exists: true, $ne: "" } } },
);

// Zod validator for PATCH body
export const ProfileUpdateValidatorSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().startsWith("https://").nullable().optional(),
  preferences: z
    .object({
      theme: z.enum(["system", "light", "dark"]).optional(),
      emailNotifications: z.boolean().optional(),
      publicProfile: z.boolean().optional(),
    })
    .optional(),
});

type IUserProfile = InferSchemaType<typeof UserProfileSchema>;

type UserProfileModel = Model<IUserProfile>;

const UserProfile = model<IUserProfile, UserProfileModel>(
  "UserProfile",
  UserProfileSchema,
);

export { UserProfile, UserProfileModel, IUserProfile };