import JSONbig from "https://esm.sh/json-bigint@1.0.0";

const jsonBig = JSONbig({ useNativeBigInt: true, alwaysParseAsBig: true });

export function jsonParse(value: string): JsonAny {
  return jsonBig.parse(value);
}

export function jsonStringify(value: JsonAny): string {
  return jsonBig.stringify(value);
}

// deno-lint-ignore no-explicit-any
export type JsonAny = any;
export type JsonObject = Record<string | symbol | number, JsonAny>;
