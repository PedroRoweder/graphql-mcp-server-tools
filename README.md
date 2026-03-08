# graphql-mcp-server-tools

MCP (Model Context Protocol) server that auto-generates tools from any GraphQL schema. Point it at your GraphQL API and AI assistants can immediately query and mutate data through auto-discovered operations.

## How it works

1. Reads your GraphQL schema (from a file, string, object, or via introspection)
2. Extracts every Query and Mutation as a separate MCP tool
3. Auto-generates field selections (with Relay connection support)
4. Converts GraphQL input types to JSON Schema for tool validation
5. Serves tools over the MCP protocol (JSON-RPC 2.0 over stdio or HTTP)

## Quick Start

### CLI

```bash
npx graphql-mcp-server-tools --schema ./schema.graphql --endpoint http://localhost:4000/graphql
```

#### Over HTTP transport (for use with MCP clients that connect via URL (like Cursor))

```bash
npx graphql-mcp-server-tools \
  --schema ./schema.graphql \
  --endpoint http://localhost:4000/graphql \
  --transport http \
  --port 3010
```

Then on the `mcp.json` file (either inside your project or globally, `~/.cursor/mcp.json` for example):

```json
{
  "mcpServers": {
    "test-graphql": {
      "url": "http://localhost:3010/mcp"
    }
  }
}
```

#### With authentication

```bash
npx graphql-mcp-server-tools \
  --schema ./schema.graphql \
  --endpoint http://localhost:4000/graphql \
  --header "Authorization:Bearer your-token"
```

#### Via introspection (no local schema file needed)

```bash
npx graphql-mcp-server-tools \
  --introspect http://localhost:4000/graphql \
  --endpoint http://localhost:4000/graphql
```

### Programmatic

```typescript
import { McpGraphQLServer } from "graphql-mcp-server-tools";

const server = new McpGraphQLServer({
  schemaPath: "./schema.graphql",
  endpoint: "http://localhost:4000/graphql",
});

// Or start as HTTP server (POST JSON-RPC to /mcp)
await server.startHttp(3010);

// Start as stdio MCP server (reads JSON-RPC from stdin, writes to stdout)
await server.startStdio();
```

### With dynamic auth tokens

```typescript
const server = new McpGraphQLServer({
  schemaPath: "./schema.graphql",
  endpoint: "http://localhost:4000/graphql",
  headers: async () => ({
    Authorization: `Bearer ${await getAccessToken()}`,
  }),
});
```

## Configuration

```typescript
interface McpGraphQLConfig {
  // Schema source (exactly one required)
  schemaPath?: string; // Path to a .graphql SDL file
  schemaString?: string; // Inline SDL string
  schema?: GraphQLSchema; // Pre-built GraphQL schema object
  introspectionEndpoint?: string; // URL to fetch schema via introspection

  // Execution (required)
  endpoint: string; // GraphQL endpoint for executing operations

  // Authentication
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

  // Customization
  serverName?: string; // MCP server name (default: "mcp-graphql")
  serverVersion?: string; // MCP server version (default: "1.0.0")
  toolPrefix?: string; // Tool name prefix (default: "graphql_")
  maxSelectionDepth?: number; // Max nested field depth (default: 2)
  verbose?: boolean; // Log full args and response data (default: false)
  customScalars?: Record<string, JsonSchema>; // Custom scalar type mappings
  operationFilter?: (op: GraphQLOperation) => boolean; // Filter which operations become tools

  // Resilience
  requestTimeout?: number; // Request timeout in ms (default: 30000)
  retries?: number; // Number of retry attempts on network failure (default: 0)
}
```

## CLI Options

```text
--schema <path>        Path to a GraphQL SDL file
--introspect <url>     URL to fetch schema via introspection query
--endpoint <url>       GraphQL endpoint URL for executing operations
--header <key:value>   HTTP header (repeatable)
--server-name <name>   MCP server name (default: "mcp-graphql")
--tool-prefix <prefix> Tool name prefix (default: "graphql_")
--max-depth <n>        Max field selection depth (default: 2)
--transport <type>     Transport type: "http" or "stdio" (default: "http")
--port <n>             HTTP server port (default: 3000, only with --transport http)
--timeout <ms>         Request timeout in milliseconds (default: 30000)
--retries <n>          Number of retry attempts on network failure (default: 0)
--verbose              Show full request arguments and response data in logs
--config <path>        Path to a JSON config file
--help                 Show help message
--version              Show version
```

## Custom Scalars

By default, unknown scalars are mapped to `{type: "string"}`. You can provide custom mappings:

```typescript
const server = new McpGraphQLServer({
  schemaPath: "./schema.graphql",
  endpoint: "http://localhost:4000/graphql",
  customScalars: {
    DateTime: { type: "string", description: "ISO 8601 date-time" },
    JSON: { type: "object", description: "Arbitrary JSON" },
    Money: { type: "string", description: "Monetary amount" },
  },
});
```

## Filtering Operations

Only expose specific operations as tools:

```typescript
const server = new McpGraphQLServer({
  schemaPath: "./schema.graphql",
  endpoint: "http://localhost:4000/graphql",
  operationFilter: (op) => op.operationType === "query", // queries only
});
```

## Advanced Usage

Lower-level utilities are exported for custom integrations:

```typescript
import { loadSchema, buildTools, graphqlTypeToJsonSchema } from "graphql-mcp-server-tools";
```

## MCP Client Configuration

Add to your MCP client config file (e.g. `mcp.json`, `claude_desktop_config.json`, `~/.cursor/mcp.json`):

### Via HTTP

Start the server, then point your MCP client at it:

```bash
npx graphql-mcp-server-tools \
  --schema ./schema.graphql \
  --endpoint http://localhost:4000/graphql \
  --transport http --port 3010
```

```json
{
  "mcpServers": {
    "my-graphql-api": {
      "url": "http://localhost:3010/mcp"
    }
  }
}
```

### Via stdio

```json
{
  "mcpServers": {
    "my-graphql-api": {
      "command": "npx",
      "args": [
        "graphql-mcp-server-tools",
        "--schema", "/path/to/schema.graphql",
        "--endpoint", "http://localhost:4000/graphql",
        "--transport", "stdio",
        "--header", "Authorization:Bearer your-token"
      ]
    }
  }
}
```

## License

MIT
