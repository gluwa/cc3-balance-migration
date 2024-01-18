import { ApiPromise, WsProvider } from "@polkadot/api/index.ts";
import { cryptoWaitReady } from "@polkadot/util-crypto/index.ts";

type ApiEndpointTy = "dev" | "test" | "main" | "local" | "cc3-dev" | string;

export class KnownEndpoint {
  static readonly DEV: ApiEndpointTy = "dev";
  static readonly TEST: ApiEndpointTy = "test";
  static readonly MAIN: ApiEndpointTy = "main";
  static readonly LOCAL: ApiEndpointTy = "local";
  static readonly CC3_DEV: ApiEndpointTy = "cc3-dev";
}

function toEndpoint(endpoint: ApiEndpointTy): string {
  switch (endpoint) {
    case KnownEndpoint.DEV:
      return "wss://rpc.devnet.creditcoin.network/ws";
    case KnownEndpoint.TEST:
      return "wss://rpc.testnet.creditcoin.network/ws";
    case KnownEndpoint.MAIN:
      return "wss://mainnet.creditcoin.network/ws";
    case KnownEndpoint.LOCAL:
      return "ws://127.0.0.1:9944";
    case KnownEndpoint.CC3_DEV:
      return "wss://rpc.cc3-devnet.creditcoin.network";
    default:
      return endpoint;
  }
}

function makeApi(
  endpoint: ApiEndpointTy = KnownEndpoint.LOCAL,
  initWasm = true,
): Promise<ApiPromise> {
  const endpointUrl = toEndpoint(endpoint);
  return ApiPromise.create({
    provider: new WsProvider(endpointUrl),
    noInitWarn: true,
    initWasm,
  });
}

export async function withApi<T>(
  endpoint: ApiEndpointTy,
  f: (api: ApiPromise) => Promise<T>,
  initWasm = true,
): Promise<T> {
  await cryptoWaitReady();
  const api = await makeApi(endpoint, initWasm);

  try {
    const result = await f(api);
    return result;
  } finally {
    await api.disconnect();
  }
}
