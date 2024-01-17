import { ApiPromise } from "@polkadot/api/bundle.ts";
import { withApi } from "./api.ts";

import { ApiDecoration } from "@polkadot/api/types/index.ts";
import { AccountId32 } from "@polkadot/types/interfaces/types.ts";
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto/mod.ts";
import { Command, HelpCommand } from "cliffy/command/mod.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { FrameSystemAccountInfo } from "@polkadot/types/lookup.ts";
import { JsonAny, JsonObject, jsonParse, jsonStringify } from "./json.ts";
import { BlockHash } from "@polkadot/types/interfaces/index.ts";

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
    public itemsName = "items",
    private lastCount = 0,
    private start = performance.now(),
    private count = 0,
    private freq = 1000
  ) {}

  log() {
    if (this.count - this.lastCount >= this.freq) {
      const now = performance.now();
      console.log(
        `rate: ${this.count / ((now - this.start) / 1000)} ${this.itemsName}/s`
      );
      this.lastCount = this.count;
    }
  }

  inc(count: number) {
    this.count += count;
    this.log();
  }
}

class Ss58AccountId {
  constructor(public value: string) {
    try {
      decodeAddress(value);
    } catch (_e) {
      try {
        this.value = encodeAddress(value);
      } catch (_e) {
        throw new Error(`invalid account id: ${value}`);
      }
    }
  }

  static from(value: string) {
    return new Ss58AccountId(value);
  }

  toJson() {
    return this.value;
  }
}

type BlockedAccounts = {
  accounts: Ss58AccountId[];
  funnel: Ss58AccountId;
};

function makeBlockedSet(blocked: BlockedAccounts) {
  const set = new Set<Ss58AccountId>();
  for (const account of blocked.accounts) {
    set.add(account);
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

  const blockedSet = blocked
    ? makeBlockedSet(blocked)
    : new Set<Ss58AccountId>();
  const funnel = blocked?.funnel.value;

  let accounts = await fetchAccounts(api);

  const rate = new RateLogger("accounts");

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
      const ss58 = new Ss58AccountId(address);
      const total = free.toBigInt() + reserved.toBigInt();

      if (funnel && blockedSet.has(ss58)) {
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
  pretty: boolean;
};

export async function migrateBalances(
  api: ApiPromise,
  options: Options,
  inputSpec: JsonObject
) {
  const config = options.config ? await parseConfig(options.config) : {};
  const finalized = await api.rpc.chain.getFinalizedHead<BlockHash>();
  // if not specified, use the finalized head
  const atHash = options.at ?? finalized.toString();
  // get a fixed view of the state at the specified block
  const apiAt = await api.at(atHash);

  // do the migration
  inputSpec = await doMigrateBalances(apiAt, inputSpec, config, options.merge);

  if (options.outputSpec) {
    // write the output spec
    console.log(`writing output to ${options.outputSpec}`);
    await Deno.writeTextFile(
      options.outputSpec,
      jsonStringify(inputSpec, undefined, options.pretty ? 2 : undefined)
    );
  } else {
    // print the output spec
    console.log(
      jsonStringify(inputSpec, undefined, options.pretty ? 2 : undefined)
    );
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
    accounts: Ss58AccountId[];
    funnel: Ss58AccountId;
  };
};

async function parseConfig(path: string) {
  const content = await Deno.readTextFile(path);
  const config = Config.parse(content);
  const newConfig: Config = {};
  if (config.blocked) {
    newConfig.blocked = {
      accounts: config.blocked.accounts.map(Ss58AccountId.from),
      funnel: Ss58AccountId.from(config.blocked.funnel),
    };
  }
  return newConfig;
}

async function main() {
  await new Command()
    .name("balance-migration")
    .description("Tool to migrate balances from CC2 to CC3")
    .default("help")
    .command("help", new HelpCommand().global())
    .command(
      "migrate [input-spec:string]",
      "Migrate balances. If no input spec is provided, a new spec will be created with only the migrated balances."
    )
    .option(
      "--output-spec -o <path:string>",
      "Output spec file path. If omitted, output will be printed to the console",
      {
        required: false,
      }
    )
    .option("-p --pretty", "Pretty print the output spec", {
      default: false,
    })
    .option(
      "--merge",
      "Merge balances from input spec into the result, instead of ignoring them",
      {
        default: false,
      }
    )
    .option("--endpoint -e <endpoint:string>", "Endpoint to connect to", {
      default: "wss://rpc.testnet.creditcoin.network/ws",
    })
    .option("--at <block-hash:string>", "Block hash to pull balances from")
    .option("--config -c <path:string>", "Config file")
    .action(async (options, inputSpec) => {
      let inputSpecObj: JsonObject;
      if (inputSpec) {
        inputSpecObj = await readSpec(inputSpec);
      } else {
        inputSpecObj = {
          genesis: {
            runtime: {
              balances: {
                balances: [],
              },
            },
          },
        };
      }

      withApi(options.endpoint, async (api) => {
        console.log("migrating balances...");

        await migrateBalances(api, options, inputSpecObj);
      });
    })
    .parse(Deno.args);
}

if (import.meta.main) {
  await main();
}
