#!/usr/bin/env node
import { main } from "./cli.js";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
