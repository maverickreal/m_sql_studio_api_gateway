import { describe, it, expect } from "vitest";
import { MongoClient } from "mongodb";
import { encodeMongoPassword } from "./index";

const HOSTS = "mongo1:27017,mongo2:27017,mongo3:27017";
const SUFFIX = "/m_sql_studio?replicaSet=rs0&authSource=m_sql_studio";

describe("encodeMongoPassword", () => {
  it("leaves a password with no reserved chars unchanged", () => {
    const uri = `mongodb://user:abc123@${HOSTS}${SUFFIX}`;
    expect(encodeMongoPassword(uri)).toBe(uri);
  });

  it("encodes a raw password containing / (the prod crash)", () => {
    const uri = `mongodb://api_gateway_user:ab/cdEF12@${HOSTS}${SUFFIX}`;
    const encoded = encodeMongoPassword(uri);
    expect(encoded).toBe(
      `mongodb://api_gateway_user:ab%2FcdEF12@${HOSTS}${SUFFIX}`,
    );
    expect(() => new MongoClient(encoded)).not.toThrow();
  });

  it("raw / password makes the driver throw, encoded does not", () => {
    const raw = `mongodb://api_gateway_user:ab/cdEF12@${HOSTS}${SUFFIX}`;
    expect(() => new MongoClient(raw)).toThrow();
    expect(() => new MongoClient(encodeMongoPassword(raw))).not.toThrow();
  });

  it("encodes @ : % + = in the password using last-@ split", () => {
    const uri = `mongodb://user:p@ss:w%o+r=d@${HOSTS}${SUFFIX}`;
    const encoded = encodeMongoPassword(uri);
    expect(encoded).toContain("p%40ss%3Aw%25o%2Br%3Dd@");
    expect(encoded).toContain(HOSTS);
    expect(encoded).toContain("replicaSet=rs0&authSource=m_sql_studio");
    expect(() => new MongoClient(encoded)).not.toThrow();
  });

  it("returns URIs without userinfo untouched", () => {
    const uri = `mongodb://${HOSTS}${SUFFIX}`;
    expect(encodeMongoPassword(uri)).toBe(uri);
  });

  it("returns non-URI strings untouched", () => {
    expect(encodeMongoPassword("not-a-valid-uri")).toBe("not-a-valid-uri");
  });
});
