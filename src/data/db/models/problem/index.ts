import { Schema, InferSchemaType, Model, model } from "mongoose";

// Materialized GitHub problem-bank document. Identity is the UUID v7 `id`
// from the YAML file, never the repo path. Deletes are tombstones
// (`deletedAt`) so historical references stay resolvable.
const ProblemSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    difficulty: {
      type: String,
      required: true,
      enum: ["easy", "medium", "hard"],
    },
    mode: { type: String, required: true, enum: ["read", "write"] },
    category: { type: String, required: true },
    sampleInput: { type: [String], required: true },
    sampleOutput: { type: String, required: true },
    initSql: { type: String, required: true },
    solutionSql: { type: String, required: false },
    validationSql: { type: String, required: false },
    orderMatters: { type: Boolean, required: true },
    author: { type: String, required: true },
    license: { type: String, required: true },
    schema_version: { type: Number, required: true },
    path: { type: String, required: true },
    gitSha: { type: String, required: false },
    deletedAt: { type: Date, required: false, default: null },
  },
  { timestamps: true },
);

type IProblem = InferSchemaType<typeof ProblemSchema>;

type ProblemModel = Model<IProblem>;

const Problem = model<IProblem, ProblemModel>("Problem", ProblemSchema, "problems");

export { Problem, ProblemSchema };
export type { IProblem };
