import pinoHttp from "pino-http";
import { logger } from "../../../config";

const apiLogger = pinoHttp({
  logger,
  redact: ["req.headers.cookie", "req.headers.authorization"],
});

export default apiLogger;
