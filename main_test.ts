import { assertEquals } from "std/assert/mod.ts";
import { Api, migrateBalances } from "./main.ts";
import { withApi } from "./api.ts";
import { encodeAddress, randomAsHex } from "@polkadot/util-crypto/mod.ts";

function makeSpec(balances: [string, bigint][]) {
  return {
    genesis: {
      runtime: {
        balances: {
          balances,
        },
      },
    },
  };
}

async function randomAccount(api: Api) {
  const keys = await api.query.system.account.keysPaged({
    pageSize: 1000,
    args: [],
  });
  
  return entry;
}

Deno.test(async function spotCheck() {
  await withApi("test", async (api) => {
    const rand = await randomAccount(api);
    console.log(rand.toString());
  });
});
