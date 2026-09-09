import { Schema, InferSchemaType, Model, model } from "mongoose";

const AuditLogSchema = new Schema(
  {
    actorId: { type: String, required: true },
    action: {
      type: String,
      required: true,
      enum: ["assignment.create", "role.change"],
    },
    targetType: {
      type: String,
      required: true,
      enum: ["assignment", "user"],
    },
    targetId: { type: String, required: true },
    at: { type: Date, required: true, default: Date.now },
    meta: {
      type: { from: { type: String }, to: { type: String } },
      required: false,
    },
  },
  { timestamps: false },
);

type IAuditLog = InferSchemaType<typeof AuditLogSchema>;

type AuditLogModel = Model<IAuditLog>;

const AuditLog = model<IAuditLog, AuditLogModel>("AuditLog", AuditLogSchema, "audit_log");

export { AuditLog, AuditLogSchema };
export type { IAuditLog };
