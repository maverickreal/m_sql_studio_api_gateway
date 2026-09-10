import { Schema, InferSchemaType, Model, model } from "mongoose";
import { z } from "zod/v4";

const UserPassSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "user", required: true, index: true },
    assignmentId: { type: Schema.Types.ObjectId, ref: "assignment", required: true, index: true },
    taskId: { type: String, required: true, unique: true },
    passedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

UserPassSchema.index({ userId: 1, assignmentId: 1 });

type IUserPass = InferSchemaType<typeof UserPassSchema>;
type UserPassModel = Model<IUserPass>;

const UserPass = model<IUserPass, UserPassModel>("UserPass", UserPassSchema);

export const UserPassZodSchema = z.object({
  userId: z.string(),
  assignmentId: z.string(),
  taskId: z.string(),
  passedAt: z.date().optional(),
});

export { UserPass, UserPassModel, IUserPass };