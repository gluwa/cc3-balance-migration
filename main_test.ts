import { doMigrateBalances } from "./main.ts";
import {
  AccountStorageKey,
  BalanceData,
  LocalAccountFetcher,
} from "./account-fetch.ts";
import { blake2AsHex, encodeAddress } from "@polkadot/util-crypto/mod.ts";
import { Ss58AccountId } from "./util.ts";

import { assertEquals } from "std/assert/mod.ts";

function makeSpec(accounts: [string, bigint][]) {
  return {
    genesis: {
      runtime: {
        balances: {
          balances: accounts,
        },
      },
    },
  };
}

let seed = 0;
function randomSs58() {
  const account = blake2AsHex(`seed${seed++}, 32`);
  return encodeAddress(account, 42);
}

function randomAccountKey(index: number) {
  const address = randomSs58();
  return {
    accountId: () => new Ss58AccountId(address),
    key: index,
  };
}

class AccountsBuilder {
  private accounts: [AccountStorageKey, BalanceData][] = [];
  private index = 0;

  add(free: bigint, reserved = 0n, miscFrozen = 0n, feeFrozen = 0n) {
    const account = randomAccountKey(this.index++);
    this.accounts.push([
      account,
      {
        free,
        reserved,
        miscFrozen,
        feeFrozen,
      },
    ]);
    return this;
  }

  addMany(count: number, free: bigint, reserved = 0n) {
    for (let i = 0; i < count; i++) {
      this.add(free, reserved);
    }
    return this;
  }

  build() {
    return this.accounts;
  }
}

function expected(
  accounts: [AccountStorageKey, BalanceData][],
): [string, bigint][] {
  return accounts.map(
    ([key, { free, reserved }]) =>
      [key.accountId().value, free + reserved] as const,
  );
}

// deno-lint-ignore no-explicit-any
function assertSpecEquals(actual: any, expected: any) {
  actual.genesis.runtime.balances.balances.sort();
  expected.genesis.runtime.balances.balances.sort();

  assertEquals(actual, expected);
}

Deno.test("basic", async () => {
  const accounts = new AccountsBuilder()
    .add(100n, 5n)
    .add(200n)
    .add(300n)
    .add(400n)
    .add(500n)
    .build();

  const input = makeSpec([]);

  const fetcher = new LocalAccountFetcher(accounts, 2);

  const result = await doMigrateBalances(fetcher, input, {});

  const expect = makeSpec(expected(accounts));

  assertSpecEquals(result, expect);
});
