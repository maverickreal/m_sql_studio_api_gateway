import "./bun-compat";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { auth } from "./auth";
import * as config from "./config";
import { system_health_check } from "./controllers";
import {
  apiLogger,
  compressionMware,
  errorHandler,
  GlobalRateLimitMware,
} from "./middleware/";
import { apiV1Router, internalRouter } from "./routes";
import webhookRouter from "./routes/webhooks";
import { CORS_ALLOWED_METHODS, EXPRESS_REQ_BODY_LIMIT } from "./utils";

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  cors({
    origin: config.envVars.CLIENT_URL,
    methods: CORS_ALLOWED_METHODS,
    credentials: true,
  }),
);

app.use(compressionMware);

app.get("/health", system_health_check);

app.use(GlobalRateLimitMware);

app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(
  express.json({
    limit: EXPRESS_REQ_BODY_LIMIT,
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: EXPRESS_REQ_BODY_LIMIT }));

app.use(apiLogger);

app.use("/api/v1", apiV1Router);
app.use("/api/webhooks", webhookRouter);
app.use("/internal", internalRouter);

app.use(errorHandler);

export default app;
