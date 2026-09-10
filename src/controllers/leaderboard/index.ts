import { Request, Response } from "express";
import { PipelineStage } from "mongoose";
import { UserPass } from "../../data/db/models/user_pass";
import { UserProfile } from "../../data/db/models/user_profile";

export interface LeaderboardEntry {
  userId: string;
  displayName: string | null;
  passes: number;
  lastPassAt: string;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  generatedAt: string;
}

const get_leaderboard = async (
  req: Request<{}, {}, {}, { limit?: string; offset?: string }>,
  res: Response,
) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 100);
  const offset = parseInt(req.query.offset || "0", 10);

  const pipeline: PipelineStage[] = [
    {
      $group: {
        _id: "$userId",
        passes: { $sum: 1 },
        lastPassAt: { $max: "$passedAt" },
      },
    },
    {
      $sort: { passes: -1, lastPassAt: 1 },
    },
    {
      $skip: offset,
    },
    {
      $limit: limit,
    },
  ];

  const [entries, total] = await Promise.all([
    UserPass.aggregate(pipeline),
    UserPass.distinct("userId").then((ids) => ids.length),
  ]);

  const enrichedEntries: LeaderboardEntry[] = await Promise.all(
    entries.map(async (entry) => {
      const profile = await UserProfile.findOne({ userId: entry._id })
        .select("displayName")
        .lean();
      const displayName = profile?.displayName ?? null;
      return {
        userId: entry._id.toString(),
        displayName,
        passes: entry.passes,
        lastPassAt: entry.lastPassAt.toISOString(),
      };
    }),
  );

  const response: LeaderboardResponse = {
    entries: enrichedEntries,
    total,
    generatedAt: new Date().toISOString(),
  };

  res.setHeader("Cache-Control", "public, max-age=15");
  res.status(200).json(response);
};

export default get_leaderboard;