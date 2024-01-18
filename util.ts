import { decodeAddress, encodeAddress } from "@polkadot/util-crypto/mod.ts";
import { ApiDecoration } from "@polkadot/api/types/index.ts";

export type Api = ApiDecoration<"promise">;

export class RateLogger {
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

  public inc(count: number) {
    this.count += count;
    this.log();
  }
}

export class Ss58AccountId {
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

  public static from(value: string) {
    return new Ss58AccountId(value);
  }

  public toJson() {
    return this.value;
  }
}
