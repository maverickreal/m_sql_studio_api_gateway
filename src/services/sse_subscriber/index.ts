import { CacheClient } from "../../data";
import { logger } from "../../config";

export type SseMessageHandler = (message: string) => void | Promise<void>;

/** Minimal subscriber surface (real redis duplicate client satisfies this). */
interface MultiplexedClient {
  subscribe: (
    channel: string,
    listener: (message: string, channel: string) => void,
  ) => Promise<void>;
  unsubscribe: (channel: string) => Promise<void>;
  quit: () => Promise<void>;
}

/**
 * Shared multiplexed Redis subscriber for SSE streams.
 *
 * One duplicated Redis connection per process, no matter how many EventSource
 * clients connect. Handlers are fanned out per channel; the underlying Redis
 * SUBSCRIBE/UNSUBSCRIBE is ref-counted (subscribe on first handler,
 * unsubscribe when the last handler leaves).
 */
const channelHandlers = new Map<string, Set<SseMessageHandler>>();
let clientPromise: Promise<MultiplexedClient> | null = null;

const onMessage = (message: string, channel: string): void => {
  const handlers = channelHandlers.get(channel);
  if (!handlers) return;
  for (const handler of [...handlers]) {
    try {
      const out = handler(message);
      if (out instanceof Promise) {
        out.catch((err: unknown) =>
          logger.error({ err, channel }, "SSE subscriber handler failed!"),
        );
      }
    } catch (err) {
      logger.error({ err, channel }, "SSE subscriber handler threw!");
    }
  }
};

const getSharedClient = async (): Promise<MultiplexedClient> => {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = (await CacheClient.get())!.duplicate() as unknown as MultiplexedClient;
      await (client as unknown as { connect: () => Promise<void> }).connect();
      return client;
    })();
    // Reset single-flight on failure so the next caller retries cleanly.
    void clientPromise.then(null, () => {
      clientPromise = null;
    });
  }
  return clientPromise;
};

class SseSubscriber {
  /**
   * Attach a handler to a channel. Resolves with an idempotent unsubscribe
   * function; calling it removes only this handler and releases the Redis
   * channel subscription when no handlers remain.
   */
  static async subscribe(
    channel: string,
    handler: SseMessageHandler,
  ): Promise<() => Promise<void>> {
    const client = await getSharedClient();

    let handlers = channelHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      channelHandlers.set(channel, handlers);
      await client.subscribe(channel, onMessage);
    }
    handlers.add(handler);

    let done = false;
    return async () => {
      if (done) return;
      done = true;
      const current = channelHandlers.get(channel);
      current?.delete(handler);
      if (current && current.size === 0) {
        channelHandlers.delete(channel);
        try {
          await client.unsubscribe(channel);
        } catch (err) {
          logger.error({ err, channel }, "Failed to unsubscribe SSE channel!");
        }
      }
    };
  }

  /** Active handler count (introspection for tests/health). */
  static handlerCount(channel?: string): number {
    if (channel) return channelHandlers.get(channel)?.size ?? 0;
    let total = 0;
    for (const set of channelHandlers.values()) total += set.size;
    return total;
  }

  static async disconnect(): Promise<void> {
    channelHandlers.clear();
    if (clientPromise) {
      const pending = clientPromise;
      clientPromise = null;
      try {
        (await pending).quit();
      } catch (err) {
        logger.error({ err }, "Failed to quit shared SSE subscriber!");
      }
    }
  }

  /** Test-only: drop cached client + handlers without touching Redis. */
  static _resetForTests(): void {
    channelHandlers.clear();
    clientPromise = null;
  }
}

export default SseSubscriber;
