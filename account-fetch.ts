import { FrameSystemAccountInfo } from "@polkadot/types/lookup.ts";
import { Api, Ss58AccountId } from "./util.ts";
import { AccountId32 } from "@polkadot/types/interfaces/types.ts";

export type BalanceData = {
  readonly free: bigint;
  readonly reserved: bigint;
  readonly miscFrozen: bigint;
  readonly feeFrozen: bigint;
};

export type AccountStorageKey = {
  accountId: () => Ss58AccountId;
  // deno-lint-ignore no-explicit-any
  key: any;
};

export abstract class AccountFetcher {
  abstract fetchAccounts(
    startKey?: AccountStorageKey,
  ): Promise<[AccountStorageKey, BalanceData][]>;
}

// deno-lint-ignore no-explicit-any
type StartKey = any;

export class ApiAccountFetcher extends AccountFetcher {
  constructor(private api: Api) {
    super();
  }

  async fetchAccounts(
    startKey?: AccountStorageKey,
  ): Promise<[AccountStorageKey, BalanceData][]> {
    const accounts = await this.api.query.system.account.entriesPaged<
      FrameSystemAccountInfo,
      [AccountId32]
    >({
      pageSize: 1000,
      args: [],
      startKey: startKey?.key,
    });

    return accounts.map(
      ([
        key,
        {
          data: { free, reserved, miscFrozen, feeFrozen },
        },
      ]) => {
        const mappedKey = {
          accountId: () => {
            const address = key.args[0].toString();
            return new Ss58AccountId(address);
          },
          key,
        };
        const mappedData = {
          free: free.toBigInt(),
          reserved: reserved.toBigInt(),
          miscFrozen: miscFrozen.toBigInt(),
          feeFrozen: feeFrozen.toBigInt(),
        };

        return [mappedKey, mappedData] as const;
      },
    );
  }
}

export class LocalAccountFetcher extends AccountFetcher {
  constructor(
    public accounts: [AccountStorageKey, BalanceData][],
    public pageSize = 1000,
  ) {
    super();
  }

  fetchAccounts(
    startKey?: AccountStorageKey,
  ): Promise<[AccountStorageKey, BalanceData][]> {
    if (!startKey) {
      return Promise.resolve(this.accounts.slice(0, this.pageSize));
    }

    if (startKey && typeof startKey.key === "number") {
      if (startKey.key + 1 >= this.accounts.length) {
        return Promise.resolve([]);
      }
      return Promise.resolve(
        this.accounts.slice(startKey.key + 1, startKey.key + 1 + this.pageSize),
      );
    }
    throw new Error("Invalid startKey " + startKey);
  }
}
