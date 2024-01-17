import JSONbig from "https://esm.sh/json-bigint@1.0.0";

const jsonBig = JSONbig({ useNativeBigInt: true, alwaysParseAsBig: true });

export function jsonParse(
  ...params: Parameters<typeof jsonBig.parse>
): JsonAny {
  return jsonBig.parse(...params);
}

export function jsonStringify(
  ...params: Parameters<typeof jsonBig.stringify>
): string {
  return jsonBig.stringify(...params);
}

// deno-lint-ignore no-explicit-any
export type JsonAny = any;
export type JsonObject = Record<string | symbol | number, JsonAny>;
