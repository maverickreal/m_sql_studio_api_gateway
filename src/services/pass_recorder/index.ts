import { UserPass } from "../../data/db/models/user_pass";

export class PassRecorder {
  static async recordPass(data: {
    userId: string;
    assignmentId: string;
    taskId: string;
  }): Promise<void> {
    try {
      await UserPass.create({
        userId: data.userId,
        assignmentId: data.assignmentId,
        taskId: data.taskId,
        passedAt: new Date(),
      });
    } catch (err: unknown) {
      // Duplicate taskId → already recorded. Ignore.
      if (
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: number }).code === 11000
      ) {
        return;
      }
      throw err;
    }
  }
}