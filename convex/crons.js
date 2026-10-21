import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every connected mailbox, checked for new 物件紹介 mail. 15 minutes balances
// "new listings show up reasonably fast" against Gmail/Graph API quota and
// Rax AI extraction cost (one call per new email, not per poll).
crons.interval(
  "sync connected mailboxes",
  { minutes: 15 },
  internal.mailIngest.syncAllAccounts,
);

export default crons;
