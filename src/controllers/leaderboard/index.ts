import { Request, Response } from "express";
import { UserPass } from "../../data/db/models/user_pass";
import { PipelineStage } from "mongoose";

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

  // Check if UserProfile model is available
  let UserProfileModel: { findById: (id: string) => Promise<{ displayName: string } | null> } | null = null;
  try {
    const mod = await import("../../data/db/models/user_profile");
    UserProfileModel = mod.UserProfile;
  } catch {
    // UserProfile not available (Slice PF not landed)
  }

  // Aggregation pipeline
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
      let displayName: string | null = null;
      if (UserProfileModel) {
        const profile = await UserProfileModel.findById(entry._id).select("displayName").lean();
        displayName = profile?.displayName ?? null;
      }
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