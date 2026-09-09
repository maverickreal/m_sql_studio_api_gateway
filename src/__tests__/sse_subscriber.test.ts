import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCacheClient, mockOnMessage } = vi.hoisted(() => ({
  mockCacheClient: {
    duplicate: vi.fn().mockReturnThis(),
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
  },
  mockOnMessage: vi.fn(),
}));

vi.mock("../data", () => ({
  CacheClient: {
    get: vi.fn().mockResolvedValue(mockCacheClient),
  },
}));

vi.mock("../config", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import SseSubscriber from "../services/sse_subscriber";

describe("SseSubscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the internal state
    (SseSubscriber as any)._resetForTests();
  });

  describe("subscribe", () => {
    it("returns a function", async () => {
      const unsubscribe = await SseSubscriber.subscribe("test-channel", vi.fn());
      expect(typeof unsubscribe).toBe("function");
    });

    it("subscribes to a channel", async () => {
      const handler = vi.fn();
      await SseSubscriber.subscribe("test-channel", handler);
      expect(mockCacheClient.subscribe).toHaveBeenCalledWith("test-channel", expect.any(Function));
    });

    it("returns idempotent unsubscribe function", async () => {
      const handler = vi.fn();
      const unsubscribe = await SseSubscriber.subscribe("test-channel", handler);

      await unsubscribe();
      await unsubscribe(); // Should not throw or double-unsubscribe

      // Should only unsubscribe once
      expect(mockCacheClient.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("tracks handler count", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      await SseSubscriber.subscribe("test-channel", handler1);
      await SseSubscriber.subscribe("test-channel", handler2);

      // Handler count should be tracked
      expect((SseSubscriber as any).handlerCount("test-channel")).toBe(2);
    });
  });

  describe("disconnect", () => {
    it("clears handlers and disconnects", async () => {
      await SseSubscriber.subscribe("test-channel", vi.fn());
      await SseSubscriber.disconnect();

      expect(mockCacheClient.quit).toHaveBeenCalled();
    });
  });

  describe("handlerCount", () => {
    it("returns 0 for no handlers", () => {
      expect((SseSubscriber as any).handlerCount("nonexistent")).toBe(0);
    });

    it("returns correct count for specific channel", async () => {
      await SseSubscriber.subscribe("test-channel", vi.fn());
      expect((SseSubscriber as any).handlerCount("test-channel")).toBe(1);
    });

    it("returns total count when no channel specified", async () => {
      await SseSubscriber.subscribe("channel-1", vi.fn());
      await SseSubscriber.subscribe("channel-2", vi.fn());
      expect((SseSubscriber as any).handlerCount()).toBe(2);
    });
  });
});