import { describe, it, expect } from "vitest";
import { parseCollectionQuery } from "../query";

const ASSIGNMENTS_CONFIG = {
  sortFields: ["createdAt", "title"],
  filterFields: {
    difficulty: ["easy", "medium", "hard"],
    mode: ["read", "write"],
  },
  searchFields: ["title", "description"],
};

describe("parseCollectionQuery — pagination", () => {
  it("defaults to page 1, limit 20, sort createdAt desc", () => {
    const r = parseCollectionQuery({}, ASSIGNMENTS_CONFIG);
    expect(r.error).toBeUndefined();
    expect(r.page).toBe(1);
    expect(r.limit).toBe(20);
    expect(r.skip).toBe(0);
    expect(r.sortQuery).toEqual({ createdAt: -1 });
    expect(r.filterQuery).toEqual({});
  });

  it("parses page/limit and computes skip", () => {
    const r = parseCollectionQuery(
      { page: "2", limit: "10" },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error).toBeUndefined();
    expect(r.page).toBe(2);
    expect(r.limit).toBe(10);
    expect(r.skip).toBe(10);
  });

  it("clamps limit > 100 to 100 with no error (backward compat)", () => {
    const r = parseCollectionQuery({ limit: "200" }, ASSIGNMENTS_CONFIG);
    expect(r.error).toBeUndefined();
    expect(r.limit).toBe(100);
  });

  it("rejects page < 1 with a 400 details entry", () => {
    const r = parseCollectionQuery({ page: "0" }, ASSIGNMENTS_CONFIG);
    expect(r.error).toBeDefined();
    expect(r.error?.status).toBe(400);
    expect(r.error?.body.details).toContainEqual({
      field: "page",
      message: "must be ≥ 1",
    });
  });
});

describe("parseCollectionQuery — sort", () => {
  it("applies whitelisted sort field with asc order", () => {
    const r = parseCollectionQuery(
      { sort: "title", order: "asc" },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error).toBeUndefined();
    expect(r.sortQuery).toEqual({ title: 1 });
  });

  it("rejects unknown sort field with allowed list", () => {
    const r = parseCollectionQuery({ sort: "nope" }, ASSIGNMENTS_CONFIG);
    expect(r.error?.body.details).toContainEqual({
      field: "sort",
      message: "invalid field 'nope'; allowed: createdAt, title",
    });
  });

  it("rejects invalid order", () => {
    const r = parseCollectionQuery({ order: "up" }, ASSIGNMENTS_CONFIG);
    expect(r.error?.body.details).toContainEqual({
      field: "order",
      message: "must be 'asc' or 'desc'",
    });
  });

  it("collects all validation errors together (not fail-fast)", () => {
    const r = parseCollectionQuery(
      { page: "0", sort: "nope", order: "up" },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error?.body.details).toHaveLength(3);
  });
});

describe("parseCollectionQuery — filter", () => {
  it("parses filter[field] bracket params with enum validation", () => {
    const r = parseCollectionQuery(
      { filter: { difficulty: "easy", mode: "read" } },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error).toBeUndefined();
    expect(r.filterQuery).toEqual({ difficulty: "easy", mode: "read" });
  });

  it("also accepts flat bracket keys when the query parser is simple", () => {
    const r = parseCollectionQuery(
      { "filter[difficulty]": "hard" },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error).toBeUndefined();
    expect(r.filterQuery).toEqual({ difficulty: "hard" });
  });

  it("accepts deprecated flat difficulty/mode aliases", () => {
    const r = parseCollectionQuery(
      { difficulty: "medium", mode: "write" },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error).toBeUndefined();
    expect(r.filterQuery).toEqual({ difficulty: "medium", mode: "write" });
  });

  it("supports comma-separated OR values as $in", () => {
    const r = parseCollectionQuery(
      { filter: { difficulty: "easy,hard" } },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error).toBeUndefined();
    expect(r.filterQuery).toEqual({ difficulty: { $in: ["easy", "hard"] } });
  });

  it("rejects invalid enum values", () => {
    const r = parseCollectionQuery(
      { filter: { difficulty: "foo" } },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error?.body.details).toContainEqual({
      field: "filter[difficulty]",
      message: "invalid value 'foo'; allowed: easy, medium, hard",
    });
  });

  it("rejects unknown filter fields", () => {
    const r = parseCollectionQuery(
      { filter: { nope: "x" } },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error?.body.details).toContainEqual({
      field: "filter[nope]",
      message: "unknown filter field 'nope'",
    });
  });

  it("ignores unknown top-level params (forward compat)", () => {
    const r = parseCollectionQuery(
      { futureParam: "1", page: "1" },
      ASSIGNMENTS_CONFIG,
    );
    expect(r.error).toBeUndefined();
    expect(r.page).toBe(1);
  });
});

describe("parseCollectionQuery — search", () => {
  it("builds an escaped case-insensitive regex $or over search fields", () => {
    const r = parseCollectionQuery({ q: "sum" }, ASSIGNMENTS_CONFIG);
    expect(r.error).toBeUndefined();
    expect(r.searchQuery).toEqual({
      $or: [
        { title: { $regex: "sum", $options: "i" } },
        { description: { $regex: "sum", $options: "i" } },
      ],
    });
  });

  it("escapes regex metacharacters in q", () => {
    const r = parseCollectionQuery({ q: "a+b (c)" }, ASSIGNMENTS_CONFIG);
    expect(r.error).toBeUndefined();
    expect(r.searchQuery).toEqual({
      $or: [
        { title: { $regex: "a\\+b \\(c\\)", $options: "i" } },
        { description: { $regex: "a\\+b \\(c\\)", $options: "i" } },
      ],
    });
  });

  it("omits searchQuery when q is absent or blank", () => {
    expect(
      parseCollectionQuery({}, ASSIGNMENTS_CONFIG).searchQuery,
    ).toBeUndefined();
    expect(
      parseCollectionQuery({ q: "   " }, ASSIGNMENTS_CONFIG).searchQuery,
    ).toBeUndefined();
  });
});
