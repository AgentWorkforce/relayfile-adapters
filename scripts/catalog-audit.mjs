#!/usr/bin/env node
import { runCatalogAuditCli } from './launch-catalog.mjs';

process.exitCode = runCatalogAuditCli();
