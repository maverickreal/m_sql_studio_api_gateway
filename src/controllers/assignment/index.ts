import { getAssignmentByIdCached } from "../../services";
import { Assignment } from "../../data";
import { Request, Response } from "express";
import {
  ASSIGNMENT_PAGINATION_DEFAULT_PAGE,
  ASSIGNMENT_PAGINATION_MAX_LIMIT,
  ASSIGNMENT_PAGINATION_DEFAULT_LIMIT,
  ASSIGNMENT_DIFFICULTY,
  ASSIGNMENT_ACCESS_LEVEL,
  parseCollectionQuery,
  type CollectionQueryConfig,
} from "../../utils";

const ASSIGNMENTS_QUERY_CONFIG: CollectionQueryConfig = {
  sortFields: ["createdAt", "title"],
  filterFields: {
    difficulty: Object.values(ASSIGNMENT_DIFFICULTY),
    mode: Object.values(ASSIGNMENT_ACCESS_LEVEL),
  },
  searchFields: ["title", "description"],
  defaultLimit: ASSIGNMENT_PAGINATION_DEFAULT_LIMIT,
  maxLimit: ASSIGNMENT_PAGINATION_MAX_LIMIT,
};

const retrieve_all_assignments = async (req: Request, res: Response) => {
  const parsed = parseCollectionQuery(
    req.query as Record<string, unknown>,
    ASSIGNMENTS_QUERY_CONFIG,
  );

  if (parsed.error !== undefined) {
    res.status(parsed.error.status).json(parsed.error.body);
    return;
  }

  // Backward-compat clamp from before the ADR: page is echoed ≥ 1.
  const page = Math.max(ASSIGNMENT_PAGINATION_DEFAULT_PAGE, parsed.page);

  const mongoFilter = {
    pgSchemaReady: true,
    ...parsed.filterQuery,
    ...(parsed.searchQuery ?? {}),
  };

  const [total, assignments] = await Promise.all([
    Assignment.countDocuments(mongoFilter),
    Assignment.find(
      mongoFilter,
      {
        _id: 1,
        title: 1,
        difficulty: 1,
        mode: 1,
      },
    )
      .sort(parsed.sortQuery)
      .skip((page - 1) * parsed.limit)
      .limit(parsed.limit)
      .lean(),
  ]);

  res.set("Cache-Control", "public, max-age=15");
  res.status(200).json({
    assignments,
    page,
    limit: parsed.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / parsed.limit),
  });
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
