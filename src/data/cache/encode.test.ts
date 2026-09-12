import { describe, it, expect } from "vitest";
import { createClient } from "redis";
import { encodeRedisPassword } from "./index";

const HOST = "redis:6379";

describe("encodeRedisPassword", () => {
  it("leaves a password with no reserved chars unchanged", () => {
    const uri = `redis://:abc123@${HOST}`;
    expect(encodeRedisPassword(uri)).toBe(uri);
  });

  it("encodes a raw password containing / (the prod crash)", () => {
    const uri = `redis://:ab/cdEF12@${HOST}`;
    const encoded = encodeRedisPassword(uri);
    expect(encoded).toBe(`redis://:ab%2FcdEF12@${HOST}`);
    expect(() => createClient({ url: encoded })).not.toThrow();
  });

  it("raw / password makes the driver throw, encoded does not", () => {
    const raw = `redis://:ab/cdEF12@${HOST}`;
    expect(() => createClient({ url: raw })).toThrow();
    expect(() => createClient({ url: encodeRedisPassword(raw) })).not.toThrow();
  });

  it("encodes @ : % + = # ? in the password using last-@ split", () => {
    const uri = `redis://:p@ss:w%o+r=d#123/?@${HOST}`;
    const encoded = encodeRedisPassword(uri);
    expect(encoded).toContain(":p%40ss%3Aw%25o%2Br%3Dd%23123%2F%3F@");
    expect(encoded).toContain(HOST);
    expect(() => createClient({ url: encoded })).not.toThrow();
    const client = createClient({ url: encoded });
    expect(client.options?.password).toBe("p@ss:w%o+r=d#123/?");
  });

  it("encodes a password when a username is specified", () => {
    const uri = `redis://default:p@ss:word@${HOST}`;
    const encoded = encodeRedisPassword(uri);
    expect(encoded).toBe(`redis://default:p%40ss%3Aword@${HOST}`);
    const client = createClient({ url: encoded });
    expect(client.options?.username).toBe("default");
    expect(client.options?.password).toBe("p@ss:word");
  });

  it("preserves db number and query params", () => {
    const uri = `redis://:p@ss@${HOST}/0?timeout=5s`;
    const encoded = encodeRedisPassword(uri);
    expect(encoded).toBe(`redis://:p%40ss@${HOST}/0?timeout=5s`);
  });

  it("supports rediss:// scheme", () => {
    const uri = `rediss://:p@ss@${HOST}`;
    const encoded = encodeRedisPassword(uri);
    expect(encoded).toBe(`rediss://:p%40ss@${HOST}`);
  });

  it("returns URIs without userinfo untouched", () => {
    const uri = `redis://${HOST}`;
    expect(encodeRedisPassword(uri)).toBe(uri);
  });

  it("returns non-URI strings untouched", () => {
    expect(encodeRedisPassword("not-a-valid-uri")).toBe("not-a-valid-uri");
  });
});
