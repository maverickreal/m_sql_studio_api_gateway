import { Schema, InferSchemaType, Model, model } from "mongoose";

const USER_SQL_STATE_TTL_SECONDS = 2592000; // 30 days

const UserSqlStateSchema = new Schema(
  {
    userId: { type: String, required: true },
    assignmentId: { type: String, required: true },
    userSql: { type: String, required: true },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

UserSqlStateSchema.index({ userId: 1, assignmentId: 1 }, { unique: true });
UserSqlStateSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: USER_SQL_STATE_TTL_SECONDS },
);

type IUserSqlState = InferSchemaType<typeof UserSqlStateSchema>;

type UserSqlStateModel = Model<IUserSqlState>;

const UserSqlState = model<IUserSqlState, UserSqlStateModel>(
  "UserSqlState",
  UserSqlStateSchema,
);

export { UserSqlState, USER_SQL_STATE_TTL_SECONDS };
