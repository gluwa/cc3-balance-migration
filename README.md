# CC3 Balance Migration Tool

A tool to migrate balances from CC2 to CC3.

## Usage

### Install dependencies

The only dependency is `deno` ([installation instructions](https://docs.deno.com/runtime/manual/getting_started/installation)).

### Run

The tool has a CLI, run it using the `deno` CLI.

For example, here's running the script
with the `-h` flag to see the help page.

```shell
deno run -A main.ts -h
```

outputs

```text
Usage: balance-migration

Description:

  Tool to migrate balances from CC2 to CC3

Options:

  -h, --help  - Show this help.  

Commands:

  help     [command]     - Show this help or the help of a sub-command.                                   
  migrate  [input-spec]  - Migrate balances. If no input spec is provided, a new spec will be created with
                           only the migrated balances.                                                    

```

(Note: `deno` runs in a sandbox, and by default will request permission to each resource used by the script as needed. The `-A` flag here allows all permissions, and effectively disables that sandbox. If you'd prefer to control exactly what external resources the script uses, just drop the `-A` flag).

#### Balance migration

To actually migrate the balances, use the `migrate` command. For example,
this would migrate balances from CC2 testnet and output a pretty-printed file `out.json` with the balances
(note, the output will be in the chainspec format).

```bash
deno run -A main.ts migrate -o out.json --pretty
```

For completeness, here are the various options:

```text
Usage: balance-migration migrate [input-spec]

Description:

  Migrate balances. If no input spec is provided, a new spec will be created with only the migrated balances.

Options:

  -h, --help                       - Show this help.                                                                                                               
  --output-spec, -o  <path>        - Output spec file path. If omitted, output will be printed to the console                                                      
  -p, --pretty                     - Pretty print the output spec                                              (Default: false)                                    
  --merge                          - Merge balances from input spec into the result, instead of ignoring them  (Default: false)                                    
  --endpoint, -e     <endpoint>    - Endpoint to connect to                                                    (Default: "wss://rpc.testnet.creditcoin.network/ws")
  --at               <block-hash>  - Block hash to pull balances from                                                                                              
  --config, -c       <path>        - Config file                                                                                                                   

Commands:

  help  [command]  - Show this help or the help of a sub-command.
```

You can also pass a configuration with a list of blocked accounts and an account to
act as the holder for the funds of those blocked accounts. For example, if we have a 
`config.json` with the contents:

```json
{
  "blocked": {
    "accounts": ["5DL96c7qhqyqFwV5N4ZWYdr3sFatNiB5gz5H9fbXcVPrQ4ME"],
    "funnel": "5EP7rG2EKSKfm8xhCsUrwEKqSZK9EWtnXZo5VwBz1pGmt7rp"
  }
}
```

Then if we add the `--config` (or `-c`) flag, the funds from `5DL96c7qhqyqFwV5N4ZWYdr3sFatNiB5gz5H9fbXcVPrQ4ME` will be redirected to `5EP7rG2EKSKfm8xhCsUrwEKqSZK9EWtnXZo5VwBz1pGmt7rp` in the output:

```bash
deno run -A main.ts migrate --pretty -o out.json --config config.json
```
