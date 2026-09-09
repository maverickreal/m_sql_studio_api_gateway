import { Schema, InferSchemaType, Model, model } from "mongoose";
import { z } from "zod/v4";
import {
  getSandboxDBSchemaIdForAssignment,
  ASSIGNMENT_DIFFICULTY,
  ASSIGNMENT_ACCESS_LEVEL,
} from "../../../../utils";

const AssignmentSchema = new Schema(
  {
    title: { type: String, required: true, minLength: 1 },
    description: { type: String, required: true, minLength: 1 },
    difficulty: { type: String, required: true, enum: ASSIGNMENT_DIFFICULTY },
    mode: { type: String, required: true, enum: ASSIGNMENT_ACCESS_LEVEL },
    sampleInput: {
      type: [{ type: String, required: true, trim: true, minlength: 1 }],
      required: true,
      minLength: 1,
    },
    sampleOutput: { type: String, required: true, minLength: 1 },
    pgSchemaReady: { type: Boolean, required: false, default: false },
    origin: { type: String, required: false, enum: ["first-party", "community"], default: "first-party" },
    contributor: { type: String, required: false },
  },
  { timestamps: true }
);

const AssignmentValidatorSchema = {
  title: z.string().nonempty().nonoptional(),
  description: z.string().nonempty().nonoptional(),
  difficulty: z.enum(ASSIGNMENT_DIFFICULTY).nonoptional(),
  mode: z.enum(ASSIGNMENT_ACCESS_LEVEL).nonoptional(),
  sampleInput: z
    .array(z.string().nonempty().nonoptional())
    .nonempty()
    .nonoptional(),
  sampleOutput: z.string().nonempty().nonoptional(),
  pgSchemaReady: z.boolean().optional(),
};

type IAssignment = InferSchemaType<typeof AssignmentSchema>;

type AssignmentModel = Model<IAssignment>;

AssignmentSchema.virtual("sandboxDbId").get(function () {
  return getSandboxDBSchemaIdForAssignment(`${this._id}`);
});

const Assignment = model<IAssignment, AssignmentModel>(
  "Assignment",
  AssignmentSchema,
);

export { Assignment, AssignmentValidatorSchema };
