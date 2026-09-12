import rateLimit, { Options, RateLimitRequestHandler } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { Request } from "express";
import { CacheClient } from "../../data";
import {
  GLOBAL_RATE_LIMIT_WINDOW_SIZE,
  GLOBAL_RATE_LIMIT_PER_WINDOW,
  REDIS_RATE_LIMIT_KEY_PREFIX,
  EXECUTE_RATE_LIMIT_WINDOW_SIZE,
  EXECUTE_RATE_LIMIT_PER_WINDOW,
  RATE_LIMIT_ERROR,
} from "../../utils";

export const isInternalRequest = (req: Request): boolean => {
  const path = (
    req.baseUrl ? req.baseUrl + req.path : req.path || req.originalUrl || ""
  ).replace(/\/+/g, "/");
  return (
    path === "/internal" ||
    path.startsWith("/internal/") ||
    path.startsWith("/internal?")
  );
};

export const getRateLimitMware = (
  scope: string,
  limitPerWindow: number,
  windowSize: number,
  options?: Partial<Options>,
): RateLimitRequestHandler => {
  const getRedisStoreForRateLimit = (prefix: string): RedisStore => {
    prefix = REDIS_RATE_LIMIT_KEY_PREFIX + prefix + ":";

    return new RedisStore({
      prefix,
      sendCommand: (...args: Array<string>) =>
        CacheClient.get().then((clientInst) => clientInst!.sendCommand(args)),
      resetExpiryOnChange: true,
    });
  };

  return rateLimit({
    message: { message: RATE_LIMIT_ERROR },
    store: options?.store ?? getRedisStoreForRateLimit(scope),
    legacyHeaders: false,
    standardHeaders: true,
    max: limitPerWindow,
    windowMs: windowSize,
    requestPropertyName: "rateLimit",
    ...options,
  });
};

export const GlobalRateLimitMware = getRateLimitMware(
  "global",
  GLOBAL_RATE_LIMIT_PER_WINDOW,
  GLOBAL_RATE_LIMIT_WINDOW_SIZE,
  {
    skip: (req) => isInternalRequest(req as Request),
  },
);

export const ExecuteRateLimitMware = getRateLimitMware(
  "execute",
  EXECUTE_RATE_LIMIT_PER_WINDOW,
  EXECUTE_RATE_LIMIT_WINDOW_SIZE,
);

