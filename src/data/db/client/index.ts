import mongoose from "mongoose";
import { MongoClient } from "mongodb";
import { type ServiceClient } from "../../../types";
import { envVars, logger } from "../../../config";

/**
 * URL-encode the password in a MongoDB connection URI.
 * The raw password may contain URI-reserved characters (/, @, :, %, +, = …)
 * that must be percent-encoded before the driver parses the URI.
 * NOTE: `new URL()` cannot be used here — a raw `/` in the password breaks
 * authority parsing, so the split is done manually: the user is everything
 * up to the first `:` after the scheme, and the password runs up to the
 * first `@` whose following segment (up to `/`, `?`, `#` or end) looks like
 * a host list (which never contains `@`). The raw password itself may
 * contain `/`, `@`, `:` and friends.
 */
export function encodeMongoPassword(uri: string): string {
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
  if (!user || /[\/?#@]/.test(user)) {
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

const encodedMongoUri = encodeMongoPassword(envVars.MONGO_URI);
export const sharedMongoClient = new MongoClient(encodedMongoUri);

class DBClient {
  private static connected = false;

  /**
   * Connect with retry. Mongo may not be ready when we start — mongo1 runs
   * setup.sh on first boot to create users, and the healthcheck won't report
   * healthy until auth works. Retry with backoff instead of crashing.
   */
  static async connect(retries = 12, delayMs = 5000): Promise<void> {
    if (DBClient.connected) {
      return;
    }

    mongoose.connection.on("connected", () => {
      logger.info("Established MongoDB connection.");
    });

    mongoose.connection.on("error", (err: Error) => {
      logger.error({ err }, "Error in MongoDB connection!");
    });

    mongoose.connection.on("disconnected", () => {
      logger.info("Terminated MongoDB connection.");
    });

    let lastErr: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await sharedMongoClient.connect();
        mongoose.connection.setClient(sharedMongoClient);
        DBClient.connected = true;
        return;
      } catch (err) {
        lastErr = err;
        logger.warn(
          { attempt, retries, err: (err as Error).message },
          "MongoDB connect failed — retrying",
        );
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    logger.error({ err: lastErr }, "MongoDB connect exhausted retries");
    throw lastErr instanceof Error
      ? lastErr
      : new Error("MongoDB connect failed");
  }

  static async disconnect() {
    if (DBClient.connected) {
      await mongoose.disconnect();
      await sharedMongoClient.close();
      DBClient.connected = false;
    }
  }
}

export default DBClient satisfies ServiceClient;
