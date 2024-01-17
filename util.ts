import { SubmittableExtrinsic } from "@polkadot/api/submittable/types.ts";
import { EventRecord } from "@polkadot/types/interfaces/index.ts";
import { ApiPromise } from "@polkadot/api/bundle.ts";

export function assertUnreachable(_x: never): never {
  throw new Error("Didn't expect to get here");
}

export function arrayRange(start: number, stop: number, step = 1) {
  return Array.from(
    { length: (stop - start) / step + 1 },
    (_value, index) => start + index * step
  );
}

export const CTC = 1_000_000_000_000_000_000n;

export function toCtc(credo: bigint) {
  return credo / CTC;
}

export function toCtcApprox(credo: bigint) {
  const o = credo / CTC;
  const rem = credo % CTC;
  const remApprox = Number(rem) / Number(CTC);
  return Number(o) + remApprox;
}

export function toCredo(ctc: bigint) {
  return ctc * CTC;
}

export function sendAndWait(
  api: ApiPromise,
  tx: SubmittableExtrinsic<"promise">,
  until: "finalized" | "inBlock" = "inBlock"
): Promise<{ blockHash: string; events: EventRecord[] }> {
  return new Promise((resolve, reject) => {
    const unsub = tx.send((result) => {
      const events = result.events;
      const findError = () => {
        for (const { event } of events) {
          if (api.events.system.ExtrinsicFailed.is(event)) {
            const [error, _info] = event.data;
            if (error.isModule) {
              // for module errors, we have the section indexed, lookup
              const decoded = api.registry.findMetaError(error.asModule);
              const { docs, method, section } = decoded;

              const errMsg = `${section}.${method}: ${docs.join(" ")}`;
              console.log(`Transaction failed with: ${errMsg}`);
              unsub.then((us) => {
                us();
                reject(error);
              });
            } else {
              // Other, CannotLookup, BadOrigin, no extra info
              console.log(`Tx failed with: ${error.toString()}`);
              unsub.then((us) => {
                us();
                reject(error);
              });
            }
          }
        }
      };
      if (result.status.isInBlock) {
        console.log(
          `Transaction included at blockHash ${result.status.asInBlock}`
        );
        const events = result.events;
        findError();
        if (until === "inBlock") {
          unsub.then((us) => {
            us();
            resolve({ blockHash: result.status.asInBlock.toString(), events });
          });
        }
      } else if (result.status.isFinalized) {
        console.log(
          `Transaction finalized at blockHash ${result.status.asFinalized}`
        );
        findError();
        if (until === "finalized") {
          unsub.then((us) => {
            us();
            resolve({
              blockHash: result.status.asFinalized.toString(),
              events: result.events,
            });
          });
        }
      } else if (result.isError) {
        console.log(`Transaction failed with ${result.dispatchError}`);
        unsub.then((us) => {
          us();
          reject(result.dispatchError);
        });
      }
    });
  });
}
