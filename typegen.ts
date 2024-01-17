import { Command } from "cliffy/command/mod.ts";

const { options } = await new Command()
  .name("typegen")
  .version("0.1.0")
  .description("Type generation")
  .option("-p, --package <package>", "Package to generate for", {
    default: "creditcoin-play/interfaces",
  })
  .option("-o, --output <output>", "Output directory", {
    default: "./typegen-interfaces",
  })
  .option("-e, --endpoint <endpoint>", "Endpoint to connect to")
  .parse(Deno.args);

if (options.endpoint) {
  console.log(`Endpoint: ${options.endpoint}`);
  const response = await fetch(options.endpoint, {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "state_getMetadata",
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });
  const json = await response.json();
  await Deno.writeFile(
    "./metadata.json",
    new TextEncoder().encode(JSON.stringify(json)),
  );
}

await Deno.mkdir(options.output, { recursive: true });

function logOutput(output: Deno.CommandOutput) {
  console.log(new TextDecoder().decode(output.stdout));
  console.error(new TextDecoder().decode(output.stderr));
}

const fromDefs = await new Deno.Command(Deno.execPath(), {
  args: [
    "run",
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "typegen/fromDefs.ts",
    "--package",
    options.package,
    "--endpoint",
    "./metadata.json",
    "--input",
    options.output,
  ],
}).output();

logOutput(fromDefs);

const fromChain = await new Deno.Command(Deno.execPath(), {
  args: [
    "run",
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "typegen/fromChain.ts",
    "--package",
    options.package,
    "--endpoint",
    "./metadata.json",
    "--output",
    options.output,
  ],
}).output();
logOutput(fromChain);

// process the output to make it work with Deno

import { walk } from "std/fs/mod.ts";

function countSlashes(s: string) {
  let count = 0;
  for (const c of s) {
    if (c === "/") {
      count++;
    }
  }
  return count;
}

function withThing(thing: string, s: string, semi: boolean) {
  return `${thing} '${s}'${semi ? ";" : ""}`;
}

const indexOnes = new Set([
  "@polkadot/rpc-core/types",
  "@polkadot/api-base/types",
  "@polkadot/types-codec",
  "@polkadot/types-codec/types",
  "@polkadot/types/types",
]);

function replaceImport(thing: string, imp: string, semi = true) {
  const withIt = (s: string) => withThing(thing, s, semi);
  if (imp.endsWith(".ts")) {
    return withIt(imp);
  } else if (imp.endsWith(".js")) {
    return withIt(imp.replace(".js", ".ts"));
  } else {
    if (indexOnes.has(imp)) {
      return withIt(`${imp}/index.ts`);
    }
    const slashes = countSlashes(imp);
    if (imp.startsWith("@polkadot/types/interfaces") && slashes === 3) {
      return withIt(`${imp}/types.ts`);
    }
    if (imp.startsWith(".") && slashes === 1) {
      return withIt(`${imp}.ts`);
    }
    console.log(`   Found ${slashes} slashes`);
    if (slashes === 1) {
      return withIt(`${imp}/mod.ts`);
    }
    return withIt(`${imp}.ts`);
  }
}

const dir = walk(options.output, {
  includeFiles: true,
  exts: [".ts"],
  includeDirs: true,
});
for await (const d of dir) {
  if (d.isFile) {
    console.log(`Checking ${d.path}`);
    const contents = await Deno.readTextFile(d.path);
    let replaced = contents.replace(
      /from \'([^\']+)\';/g,
      function (_sub, imp: string) {
        console.log(`Replacing ${imp}`);
        return replaceImport("from", imp);
      },
    );
    replaced = replaced.replace(
      /import \'([^\']+)\';/g,
      function (_sub, imp: string) {
        console.log(`Replacing ${imp}`);
        return replaceImport("import", imp);
      },
    );
    replaced = replaced.replace(
      /declare module \'([^\']+)\'/g,
      function (_sub, imp: string) {
        console.log(`Replacing ${imp}`);
        return replaceImport("declare module", imp, false);
      },
    );
    if (replaced !== contents) {
      await Deno.writeTextFile(d.path, replaced);
      console.log(`Updated ${d.path}`);
    }
  }
}
