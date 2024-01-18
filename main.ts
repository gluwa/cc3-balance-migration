import { ApiPromise } from "@polkadot/api/bundle.ts";
import { withApi } from "./api.ts";
import {
  AccountFetcher,
  AccountStorageKey,
  ApiAccountFetcher,
} from "./account-fetch.ts";

import { Command, HelpCommand } from "cliffy/command/mod.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { JsonAny, JsonObject, jsonParse, jsonStringify } from "./json.ts";
import { BlockHash } from "@polkadot/types/interfaces/index.ts";
import { RateLogger, Ss58AccountId } from "./util.ts";

async function fetchAccounts(
  fetcher: AccountFetcher,
  startKey?: AccountStorageKey
) {
  const accounts = await fetcher.fetchAccounts(startKey);
  return accounts;
}

type BalanceMap = Map<string, bigint>;

type BlockedAccounts = {
  accounts: Ss58AccountId[];
  funnel: Ss58AccountId;
};

function makeBlockedSet(blocked: BlockedAccounts) {
  const set = new Set<string>();
  for (const account of blocked.accounts) {
    set.add(account.value);
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
  fetcher: AccountFetcher,
  initial?: [string, bigint][],
  blocked?: BlockedAccounts
) {
  const balances: BalanceMap = new Map(initial ?? []);

  const blockedSet = blocked ? makeBlockedSet(blocked) : new Set<string>();
  const funnel = blocked?.funnel.value;

  let accounts = await fetchAccounts(fetcher);

  const rate = new RateLogger("accounts");

  while (accounts.length > 0) {
    const lastKey = accounts[accounts.length - 1][0];

    for (const [key, { free, reserved }] of accounts) {
      const ss58 = key.accountId();
      const address = ss58.value;
      const total = free + reserved;

      if (funnel && blockedSet.has(address)) {
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

    accounts = await fetchAccounts(fetcher, lastKey);
  }

  return balances;
}

export async function doMigrateBalances(
  fetcher: AccountFetcher,
  inputSpec: JsonAny,
  config: Config,
  merge = false
) {
  // map balances
  const mapped = await mapBalances(
    fetcher,
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

  const fetcher = new ApiAccountFetcher(apiAt);

  // do the migration
  inputSpec = await doMigrateBalances(
    fetcher,
    inputSpec,
    config,
    options.merge
  );

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
  const contentJson = jsonParse(content);
  const config = Config.parse(contentJson);
  const newConfig: Config = {};
  if (config.blocked) {
    newConfig.blocked = {
      accounts: config.blocked.accounts.map(Ss58AccountId.from),
      funnel: Ss58AccountId.from(config.blocked.funnel),
    };
  }
  return newConfig;
}

async function inputSpecOrDefault(inputSpec?: string) {
  if (inputSpec) {
    return await readSpec(inputSpec);
  } else {
    return {
      genesis: {
        runtime: {
          balances: {
            balances: [],
          },
        },
      },
    };
  }
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
      const spec = await inputSpecOrDefault(inputSpec);

      withApi(options.endpoint, async (api) => {
        console.log("migrating balances...");

        await migrateBalances(api, options, spec);
      });
    })
    .parse(Deno.args);
}

if (import.meta.main) {
  await main();
}
