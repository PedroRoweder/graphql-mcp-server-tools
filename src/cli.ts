#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { McpGraphQLServer } from "./server.js";
import type { McpGraphQLConfig } from "./types.js";

function printHelp(): void {
  console.log(`
graphql-mcp-server-tools - MCP server that auto-generates tools from any GraphQL schema

Usage:
  graphql-mcp-server-tools --schema <path> --endpoint <url> [options]
  graphql-mcp-server-tools --introspect <url> --endpoint <url> [options]
  graphql-mcp-server-tools --config <path>

Schema source (one required):
  --schema <path>        Path to a GraphQL SDL file
  --introspect <url>     URL to fetch schema via introspection query

Execution:
  --endpoint <url>       GraphQL endpoint URL for executing operations
  --header <key:value>   HTTP header (repeatable)

Transport:
  --transport <type>     Transport type: "http" or "stdio" (default: "http")
  --port <n>             HTTP server port (default: 3000, only with --transport http)

Customization:
  --server-name <name>   MCP server name (default: "mcp-graphql")
  --tool-prefix <prefix> Tool name prefix (default: "graphql_")
  --max-depth <n>        Max field selection depth (default: 2)

Logging:
  --verbose              Show full request arguments and response data in logs

Other:
  --config <path>        Path to a JSON config file
  --help                 Show this help message
  --version              Show version
`);
}

interface CliOptions {
  config: McpGraphQLConfig;
  transport: "stdio" | "http";
  port: number;
}

function parseArgs(argv: string[]): CliOptions {
  let schemaPath: string | undefined;
  let introspectionEndpoint: string | undefined;
  let endpoint: string | undefined;
  let serverName: string | undefined;
  let toolPrefix: string | undefined;
  let maxSelectionDepth: number | undefined;
  let configPath: string | undefined;
  let transport: "stdio" | "http" = "http";
  let port = 3000;
  let verbose = false;
  const headers: Record<string, string> = {};

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--help":
        printHelp();
        process.exit(0);
        break; // unreachable but satisfies linter
      case "--version": {
        const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
          version: string;
        };
        console.log(pkg.version);
        process.exit(0);
        break;
      }
      case "--schema":
        schemaPath = next;
        i++;
        break;
      case "--introspect":
        introspectionEndpoint = next;
        i++;
        break;
      case "--endpoint":
        endpoint = next;
        i++;
        break;
      case "--header": {
        const colonIdx = next?.indexOf(":");
        if (!next || colonIdx === undefined || colonIdx < 1) {
          console.error("Error: --header requires format key:value");
          process.exit(1);
        }
        headers[next.slice(0, colonIdx).trim()] = next.slice(colonIdx + 1).trim();
        i++;
        break;
      }
      case "--server-name":
        serverName = next;
        i++;
        break;
      case "--tool-prefix":
        toolPrefix = next;
        i++;
        break;
      case "--max-depth":
        maxSelectionDepth = parseInt(next, 10);
        if (isNaN(maxSelectionDepth)) {
          console.error("Error: --max-depth must be a number");
          process.exit(1);
        }
        i++;
        break;
      case "--transport":
        if (next !== "stdio" && next !== "http") {
          console.error('Error: --transport must be "stdio" or "http"');
          process.exit(1);
        }
        transport = next;
        i++;
        break;
      case "--port":
        port = parseInt(next, 10);
        if (isNaN(port)) {
          console.error("Error: --port must be a number");
          process.exit(1);
        }
        i++;
        break;
      case "--verbose":
        verbose = true;
        break;
      case "--config":
        configPath = next;
        i++;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  // Load config file if provided
  let fileConfig: Partial<McpGraphQLConfig> = {};
  if (configPath) {
    fileConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<McpGraphQLConfig>;
  }

  // CLI flags override config file
  const config: McpGraphQLConfig = {
    ...fileConfig,
    endpoint: endpoint ?? fileConfig.endpoint ?? "",
  };

  if (schemaPath) config.schemaPath = schemaPath;
  if (introspectionEndpoint) config.introspectionEndpoint = introspectionEndpoint;
  if (Object.keys(headers).length > 0) config.headers = headers;
  if (serverName) config.serverName = serverName;
  if (toolPrefix) config.toolPrefix = toolPrefix;
  if (maxSelectionDepth !== undefined) config.maxSelectionDepth = maxSelectionDepth;
  if (verbose) config.verbose = true;

  return { config, transport, port };
}

async function main(): Promise<void> {
  const { config, transport, port } = parseArgs(process.argv);

  if (!config.endpoint) {
    console.error("Error: --endpoint is required");
    printHelp();
    process.exit(1);
  }

  if (!config.schemaPath && !config.schemaString && !config.schema && !config.introspectionEndpoint) {
    console.error("Error: A schema source is required (--schema or --introspect)");
    printHelp();
    process.exit(1);
  }

  const server = new McpGraphQLServer(config);

  if (transport === "http") {
    await server.startHttp(port);
  } else {
    await server.startStdio();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
