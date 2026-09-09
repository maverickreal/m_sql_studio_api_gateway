import { Schema, InferSchemaType, Model, model } from "mongoose";

// Singleton row tracking the GitHub problem-bank sync cursor.
const SyncStateSchema = new Schema(
  {
    _id: { type: String, required: true },
    repo: { type: String, required: true },
    lastSha: { type: String, required: false },
    lastDeliveryId: { type: String, required: false },
    lastSyncAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

type ISyncState = InferSchemaType<typeof SyncStateSchema>;

type SyncStateModel = Model<ISyncState>;

const SyncState = model<ISyncState, SyncStateModel>(
  "SyncState",
  SyncStateSchema,
  "sync_state",
);

export { SyncState, SyncStateSchema };
export type { ISyncState };
