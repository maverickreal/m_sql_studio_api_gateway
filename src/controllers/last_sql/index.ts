import { Request, Response } from "express";
import { UserSqlState } from "../../data/db/models/user_sql_state";
import { MAX_USER_SQL_CODE_LEN } from "../../utils";
import { logger } from "../../config";

const get_last_sql = async (req: Request, res: Response) => {
  const assignmentId = req.params.id as string;

  try {
    const doc = await UserSqlState.findOne({
      userId: req.user!.id,
      assignmentId,
    }).lean();

    if (!doc) {
      res.status(200).json({ userSql: null });
      return;
    }

    res
      .status(200)
      .json({ userSql: doc.userSql, updatedAt: doc.updatedAt });
  } catch (err) {
    logger.error(
      { err, assignmentId },
      "Failed to fetch last submitted SQL!",
    );
    res.status(500).json({ error: "Failed to fetch last submitted SQL!" });
  }
};

const save_last_sql = async (req: Request, res: Response) => {
  const assignmentId = req.params.id as string;
  const { userSql } = req.body ?? {};

  if (
    typeof userSql !== "string" ||
    userSql.length < 1 ||
    userSql.length > MAX_USER_SQL_CODE_LEN
  ) {
    res.status(400).json({ error: "An invalid SQL query provided!" });
    return;
  }

  try {
    await UserSqlState.findOneAndUpdate(
      { userId: req.user!.id, assignmentId },
      { userSql, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err, assignmentId }, "Failed to save last submitted SQL!");
    res.status(500).json({ error: "Failed to save last submitted SQL!" });
  }
};

export { get_last_sql, save_last_sql };
