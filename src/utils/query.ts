export interface CollectionQueryConfig {
  sortFields: string[];
  filterFields: Record<string, string[]>;
  searchFields: string[];
  defaultSort?: string;
  defaultOrder?: "asc" | "desc";
  defaultLimit?: number;
  maxLimit?: number;
}

export interface CollectionQueryDetail {
  field: string;
  message: string;
}

export interface CollectionQueryError {
  status: 400;
  body: {
    error: string;
    details: CollectionQueryDetail[];
  };
}

export interface ParsedCollectionQuery {
  page: number;
  limit: number;
  skip: number;
  filterQuery: Record<string, unknown>;
  sortQuery: Record<string, 1 | -1>;
  searchQuery?: Record<string, unknown>;
  error?: CollectionQueryError;
}

type RawQuery = Record<string, unknown>;

const firstValue = (v: unknown): unknown =>
  Array.isArray(v) ? v[0] : v;

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Collects `filter[field]` entries from both extended-parser shape
// (`filter` object) and simple-parser shape (`filter[field]` flat keys).
const collectFilterEntries = (rawQuery: RawQuery): Array<[string, unknown]> => {
  const entries: Array<[string, unknown]> = [];
  const nested = rawQuery.filter;
  if (nested !== undefined && typeof nested === "object" && nested !== null) {
    for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
      entries.push([k, v]);
    }
  }
  for (const [k, v] of Object.entries(rawQuery)) {
    const m = /^\s*filter\[([^\]]+)\]\s*$/.exec(k);
    if (m?.[1] !== undefined) entries.push([m[1], v]);
  }
  return entries;
};

const toError = (details: CollectionQueryDetail[]): CollectionQueryError => ({
  status: 400,
  body: { error: "Invalid query parameter", details },
});

/**
 * Shared ADR 004 collection-query parser (P5).
 * Offset/limit pagination with page/limit/q/sort/order/filter[field] params.
 * Additive: missing page/limit fall back to defaults; limit > max is clamped
 * with no error (backward compat); unknown top-level params are ignored.
 */
export const parseCollectionQuery = (
  rawQuery: RawQuery,
  config: CollectionQueryConfig,
): ParsedCollectionQuery => {
  const details: CollectionQueryDetail[] = [];
  const defaultLimit = config.defaultLimit ?? 20;
  const maxLimit = config.maxLimit ?? 100;

  // --- page ---
  let page = 1;
  const rawPage = firstValue(rawQuery.page);
  if (rawPage !== undefined) {
    const n = Number(rawPage);
    if (!Number.isInteger(n) || n < 1) {
      details.push({ field: "page", message: "must be ≥ 1" });
    } else {
      page = n;
    }
  }

  // --- limit (clamped, never an error) ---
  let limit = defaultLimit;
  const rawLimit = firstValue(rawQuery.limit);
  if (rawLimit !== undefined) {
    const n = Number(rawLimit);
    if (Number.isFinite(n)) {
      limit = Math.min(maxLimit, Math.max(1, Math.floor(n)));
    }
  }

  // --- sort + order (whitelisted, collected with other errors) ---
  const defaultSort = config.defaultSort ?? "createdAt";
  const defaultOrder = config.defaultOrder ?? "desc";
  let sortField = defaultSort;
  let sortDir: 1 | -1 = defaultOrder === "asc" ? 1 : -1;
  const rawSort = firstValue(rawQuery.sort);
  if (rawSort !== undefined) {
    const s = String(rawSort);
    if (!config.sortFields.includes(s)) {
      details.push({
        field: "sort",
        message: `invalid field '${s}'; allowed: ${config.sortFields.join(", ")}`,
      });
    } else {
      sortField = s;
    }
  }
  const rawOrder = firstValue(rawQuery.order);
  if (rawOrder !== undefined) {
    const o = String(rawOrder);
    if (o !== "asc" && o !== "desc") {
      details.push({ field: "order", message: "must be 'asc' or 'desc'" });
    } else {
      sortDir = o === "asc" ? 1 : -1;
    }
  }
  const sortQuery: Record<string, 1 | -1> = { [sortField]: sortDir };

  // --- filter[field] (exact match, enum-validated, AND across fields) ---
  const filterQuery: Record<string, unknown> = {};
  for (const [field, rawVal] of collectFilterEntries(rawQuery)) {
    const allowed = config.filterFields[field];
    if (allowed === undefined) {
      details.push({
        field: `filter[${field}]`,
        message: `unknown filter field '${field}'`,
      });
      continue;
    }
    const strVal = String(firstValue(rawVal) ?? "");
    const values = strVal
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    const bad = values.filter((v) => !allowed.includes(v));
    if (bad.length > 0) {
      details.push({
        field: `filter[${field}]`,
        message: `invalid value '${bad[0]}'; allowed: ${allowed.join(", ")}`,
      });
      continue;
    }
    if (values.length === 1) {
      filterQuery[field] = values[0];
    } else if (values.length > 1) {
      filterQuery[field] = { $in: values };
    }
  }
  // Deprecated flat aliases: a top-level key naming a filter field
  // (e.g. `difficulty=easy`) behaves like `filter[difficulty]=easy`.
  for (const [field, allowed] of Object.entries(config.filterFields)) {
    if (field in filterQuery || rawQuery[field] === undefined) continue;
    if (field === "filter") continue;
    const strVal = String(firstValue(rawQuery[field]) ?? "");
    if (strVal === "") continue;
    const values = strVal
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    const bad = values.filter((v) => !allowed.includes(v));
    if (bad.length > 0) {
      details.push({
        field: `filter[${field}]`,
        message: `invalid value '${bad[0]}'; allowed: ${allowed.join(", ")}`,
      });
      continue;
    }
    filterQuery[field] = values.length === 1 ? values[0] : { $in: values };
  }

  // --- free-text search q (escaped case-insensitive partial match) ---
  let searchQuery: Record<string, unknown> | undefined;
  const rawQ = firstValue(rawQuery.q);
  if (
    rawQ !== undefined &&
    config.searchFields.length > 0 &&
    String(rawQ).trim() !== ""
  ) {
    const pattern = escapeRegExp(String(rawQ).trim());
    searchQuery = {
      $or: config.searchFields.map((f) => ({
        [f]: { $regex: pattern, $options: "i" },
      })),
    };
  }

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    filterQuery,
    sortQuery,
    ...(searchQuery !== undefined ? { searchQuery } : {}),
    error: details.length > 0 ? toError(details) : undefined,
  };
};
