// First, for the reason given in src/loadEnv.ts: ./index pulls in the Supabase
// client, which reads env as it is evaluated.
import "../loadEnv";

import {
  claimOrphanedData, dataOwnershipReport, wipeListings, wipeOrphanedData, wipeTenantData,
} from "./index";

const [command, arg] = process.argv.slice(2);

const commands: Record<string, () => Promise<unknown>> = {
  report: () => dataOwnershipReport(),
  "wipe-tenant": () => wipeTenantData(arg),
  "wipe-orphaned": () => wipeOrphanedData(arg),
  "wipe-listings": () => wipeListings(arg),
  claim: () => claimOrphanedData(arg),
};

const run = commands[command];
if (!run) {
  console.error(`Usage: npm run maintain -- <${Object.keys(commands).join("|")}> [arg]`);
  process.exit(1);
}

run()
  .then((out) => console.log(JSON.stringify(out, null, 2)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
