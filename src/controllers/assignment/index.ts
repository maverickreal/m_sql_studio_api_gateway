import { getAssignmentByIdCached } from "../../services";
import { Assignment } from "../../data";
import { Request, Response } from "express";
import {
  ASSIGNMENT_PAGINATION_DEFAULT_PAGE,
  ASSIGNMENT_PAGINATION_MAX_LIMIT,
  ASSIGNMENT_PAGINATION_DEFAULT_LIMIT,
} from "../../utils";

const retrieve_all_assignments = async (req: Request, res: Response) => {
  const page = Math.max(
    1,
    Number(req.query.page) || ASSIGNMENT_PAGINATION_DEFAULT_PAGE,
  );

  let limit: number =
    Number(req.query.limit) || ASSIGNMENT_PAGINATION_DEFAULT_LIMIT;
  limit = Math.min(ASSIGNMENT_PAGINATION_MAX_LIMIT, Math.max(1, limit));

  const assignments = await Assignment.find(
    { pgSchemaReady: true },
    {
      _id: 1,
      title: 1,
      difficulty: 1,
      mode: 1,
    },
  )
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.set("Cache-Control", "public, max-age=15");
  res.status(200).json({ assignments });
};

const retrieve_assignment = async (req: Request, res: Response) => {
  const reqId = req.params.id as string;

  const assignment = await getAssignmentByIdCached(reqId);

  if (!assignment) {
    res.status(404).json({ error: "Assignment not found!" });

    return;
  }
  res
    .status(assignment.pgSchemaReady ? 200 : 503)
    .json(
      assignment.pgSchemaReady
        ? { assignment }
        : { error: "Assignment unavailable at the moment!" },
    );
};

export { retrieve_all_assignments, retrieve_assignment };
