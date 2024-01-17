import { ApiPromise } from "@polkadot/api/bundle.ts";
import { withApi } from "./api.ts";
import { decodeHex } from "std/encoding/hex.ts";
import { concat } from "std/bytes/mod.ts";
import { ApiDecoration } from "@polkadot/api/types/index.ts";
import { AccountId32 } from "@polkadot/types/interfaces/types.ts";
import {
  blake2AsHex,
  decodeAddress,
  encodeAddress,
} from "@polkadot/util-crypto/mod.ts";
import { Command, HelpCommand } from "cliffy/command/mod.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { FrameSystemAccountInfo } from "@polkadot/types/lookup.ts";
import { JsonAny, JsonObject, jsonParse, jsonStringify } from "./json.ts";

export type Api = ApiDecoration<"promise">;

// deno-lint-ignore no-explicit-any
type StartKey = any;

async function fetchAccounts(api: Api, startKey?: StartKey) {
  const accounts = await api.query.system.account.entriesPaged<
    FrameSystemAccountInfo,
    [AccountId32]
  >({
    pageSize: 1000,
    args: [],
    startKey,
  });
  return accounts;
}

type BalanceMap = Map<string, bigint>;

class RateLogger {
  constructor(
    private lastCount = 0,
    private start = performance.now(),
    private count = 0,
    private freq = 1000
  ) {}

  log() {
    if (this.count - this.lastCount >= this.freq) {
      const now = performance.now();
      console.log(`rate: ${this.count / ((now - this.start) / 1000)}/s`);
      this.lastCount = this.count;
    }
  }

  inc(count: number) {
    this.count += count;
    this.log();
  }
}

type SubstrateAccountId = {
  type: "substrate";
  value: string;
};

type EvmAccountId = {
  type: "evm";
  value: string;
};

type AccountId = SubstrateAccountId | EvmAccountId;

export function evmAddressToSubstrateAddress(evmAddress: string) {
  const evmAddressBytes = decodeHex(evmAddress.replace("0x", ""));
  const prefixBytes = new TextEncoder().encode("evm:");
  const concatBytes = concat([prefixBytes, evmAddressBytes]);
  const addressHex = blake2AsHex(concatBytes, 256);
  const substrateAddress = encodeAddress(addressHex);
  return substrateAddress;
}

function evmToSubstrate(value: EvmAccountId): SubstrateAccountId {
  return {
    type: "substrate",
    value: evmAddressToSubstrateAddress(value.value),
  };
}

function toSubstrate(value: AccountId): SubstrateAccountId {
  switch (value.type) {
    case "substrate":
      return value;
    case "evm":
      return evmToSubstrate(value);
  }
}

type BlockedAccounts = {
  accounts: SubstrateAccountId[];
  funnel: AccountId;
};

function makeBlockedSet(blocked: BlockedAccounts) {
  const set = new Set<string>();
  for (const account of blocked.accounts) {
    set.add(toSubstrate(account).value);
  }
  return set;
}

async function readSpec(path: string): Promise<JsonObject> {
  const content = jsonParse(await Deno.readTextFile(path)) as JsonAny;
  if (
    typeof content !== "object" ||
    content === null ||
    Array.isArray(content)
  ) {
    throw new Error(`invalid spec: ${path}`);
  }

  return content;
}

function makeBalancesConfig(balances: BalanceMap) {
  const config = [];
  for (const [address, balance] of balances) {
    config.push([address, balance] as const);
  }
  return config;
}

async function mapBalances(
  api: Api,
  initial?: [string, bigint][],
  blocked?: BlockedAccounts
) {
  const balances: BalanceMap = new Map(initial ?? []);

  const blockedSet = blocked ? makeBlockedSet(blocked) : new Set<string>();
  const funnel = blocked ? toSubstrate(blocked.funnel).value : "";

  let accounts = await fetchAccounts(api);

  const rate = new RateLogger();

  while (accounts.length > 0) {
    const lastKey = accounts[accounts.length - 1][0];
    accounts = await fetchAccounts(api, lastKey);

    for (const [
      key,
      {
        data: { free, reserved },
      },
    ] of accounts) {
      const address = key.args[0].toString();
      const total = free.toBigInt() + reserved.toBigInt();

      if (blockedSet.has(address)) {
        const existing = balances.get(funnel) ?? 0n;
        balances.set(funnel, existing + total);
      } else {
        if (balances.get(address)) {
          throw new Error(`duplicate account: ${address}`);
        }
        balances.set(address, total);
      }
    }

    rate.inc(accounts.length);
  }

  return balances;
}

async function doMigrateBalances(
  api: Api,
  inputSpec: JsonAny,
  config: Config,
  merge: boolean
) {
  // map balances
  const mapped = await mapBalances(
    api,
    merge ? inputSpec.genesis.runtime.balances.balances : undefined,
    config.blocked
  );

  // put the balances into the spec's expected format
  const balances = makeBalancesConfig(mapped);

  // update the spec
  inputSpec.genesis.runtime.balances.balances = balances;

  return inputSpec;
}

type Options = {
  outputSpec?: string | undefined;
  config?: string | undefined;
  at?: string | undefined;
  merge: boolean;
};

export async function migrateBalances(
  api: ApiPromise,
  options: Options,
  inputSpec: string
) {
  const config = options.config ? await parseConfig(options.config) : {};
  // if not specified, use the finalized head
  const atHash =
    options.at ?? (await api.rpc.chain.getFinalizedHead()).toString();
  // get a fixed view of the state at the specified block
  const apiAt = await api.at(atHash);
  // read the input spec
  let input = await readSpec(inputSpec);
  console.log(input);
  // do the migration
  input = doMigrateBalances(apiAt, input, config, options.merge);

  if (options.outputSpec) {
    // write the output spec
    await Deno.writeTextFile(options.outputSpec, jsonStringify(input));
  } else {
    console.log(jsonStringify(input));
  }
}

const Config = z.object({
  blocked: z
    .object({
      accounts: z.array(z.string()),
      funnel: z.string(),
    })
    .optional(),
});

type Config = {
  blocked?: {
    accounts: SubstrateAccountId[];
    funnel: SubstrateAccountId;
  };
};

function parseSubstrateAccountId(value: string): SubstrateAccountId {
  if (value.startsWith("0x") || value.length !== 48) {
    throw new Error(`invalid substrate account id: ${value}`);
  }
  decodeAddress(value);
  return {
    type: "substrate",
    value,
  };
}

async function parseConfig(path: string) {
  const content = await Deno.readTextFile(path);
  const config = Config.parse(content);
  const newConfig: Config = {};
  if (config.blocked) {
    newConfig.blocked = {
      accounts: config.blocked.accounts.map(parseSubstrateAccountId),
      funnel: parseSubstrateAccountId(config.blocked.funnel),
    };
  }
  return newConfig;
}

async function main(api: ApiPromise) {
  await new Command()
    .name("balance-migration")
    .default("help")
    .command("help", new HelpCommand().global())
    .command("migrate <input-spec:string>", "Migrate balances")
    .description("Tool to migrate balances from CC2 to CC3")
    .option("--output-spec -o <path:string>", "Output spec file", {
      required: false,
    })
    .option(
      "--merge",
      "Merge balances from input spec into the result, instead of ignoring them",
      {
        default: false,
      }
    )
    .option("--at <block-hash:string>", "Block hash to pull balances from")
    .option("--config -c <path:string>", "Config file")
    .action(async (options, inputSpec) => {
      await migrateBalances(api, options, inputSpec);
    })
    .parse(Deno.args);
}

if (import.meta.main) {
  await withApi("test", main);
}
