import { createClient, RedisClientType } from "redis";
import { type ServiceClient } from "../../types";
import { logger, envVars } from "../../config";

/**
 * URL-encode the password in a Redis connection URI.
 * The raw password may contain URI-reserved characters (/, @, :, %, +, =, #, ? …)
 * that must be percent-encoded before the driver parses the URI.
 * NOTE: `new URL()` cannot be used here — raw reserved characters in the password
 * break authority parsing, so the split is done manually: the user is everything
 * up to the first `:` after the scheme, and the password runs up to the
 * first `@` whose following segment (up to `/`, `?`, `#` or end) looks like
 * a host list (which never contains `@`). The raw password itself may
 * contain `/`, `@`, `:` and friends.
 */
export function encodeRedisPassword(uri: string): string {
  const schemeIdx = uri.indexOf("://");
  if (schemeIdx < 0) {
    return uri;
  }
  const prefix = uri.slice(0, schemeIdx + 3);
  const rest = uri.slice(schemeIdx + 3);
  const colonIdx = rest.indexOf(":");
  if (colonIdx < 0) {
    return uri;
  }
  const user = rest.slice(0, colonIdx);
  if (/[\/?#@]/.test(user)) {
    return uri;
  }
  const afterUser = rest.slice(colonIdx + 1);
  let atIdx = -1;
  let hosts = "";
  let suffix = "";
  let searchFrom = 0;
  while (true) {
    const i = afterUser.indexOf("@", searchFrom);
    if (i < 0) {
      break;
    }
    const afterAt = afterUser.slice(i + 1);
    let hostEnd = afterAt.search(/[\/?#]/);
    if (hostEnd < 0) {
      hostEnd = afterAt.length;
    }
    const candidate = afterAt.slice(0, hostEnd);
    if (candidate.length > 0 && /^[A-Za-z0-9.,_:\[\]-]+$/.test(candidate)) {
      atIdx = i;
      hosts = candidate;
      suffix = afterAt.slice(hostEnd);
      break;
    }
    searchFrom = i + 1;
  }
  if (atIdx < 0) {
    return uri;
  }
  const password = afterUser.slice(0, atIdx);
  if (!password) {
    return uri;
  }
  return `${prefix}${user}:${encodeURIComponent(password)}@${hosts}${suffix}`;
}

export const encodedRedisUrl = encodeRedisPassword(envVars.REDIS_URL);

class CacheClient {
  private static clientInst: RedisClientType | null = null;

  static async connect() {
    if (CacheClient.clientInst !== null) {
      return;
    }

    const cacheObj: RedisClientType = createClient({ url: encodedRedisUrl });

    cacheObj.on("error", (err: Error) => {
      logger.error({ err }, "Error in Redis connection!");
    });

    cacheObj.on("end", () => {
      logger.info("Terminated Redis connection.");
    });

    cacheObj.on("ready", () => {
      logger.info("Established Redis connection.");
    });

    await cacheObj.connect();
    CacheClient.clientInst = cacheObj;
  }

  static async disconnect() {
    if (CacheClient.clientInst) {
      await CacheClient.clientInst.quit();
      CacheClient.clientInst = null;
    }
  }

  static async get() {
    if (!CacheClient.clientInst) {
      await CacheClient.connect();
    }

    return CacheClient.clientInst;
  }
}

export default CacheClient satisfies ServiceClient;
