import type {GraphQLArgument, GraphQLOutputType, GraphQLSchema} from 'graphql'

/** JSON Schema representation used for MCP tool `inputSchema` fields. */
export interface JsonSchema {
	type?: string
	description?: string
	enum?: string[]
	items?: JsonSchema
	properties?: Record<string, JsonSchema>
	required?: string[]
}

/** A single QueryRoot or Mutation field extracted from the GraphQL schema. */
export interface GraphQLOperation {
	name: string
	description: string
	operationType: 'query' | 'mutation'
	args: readonly GraphQLArgument[]
	returnType: GraphQLOutputType
}

/** The result of parsing a GraphQL schema: all operations plus the raw schema for type lookups. */
export interface ParsedSchema {
	operations: GraphQLOperation[]
	schema: GraphQLSchema
}

/** An MCP tool definition generated from a single GraphQL operation. */
export interface McpToolDefinition {
	name: string
	description: string
	inputSchema: {type: string; properties?: Record<string, unknown>; required?: string[]}
	document: string
}

/** The result shape returned by MCP tool execution, matching the MCP protocol spec. */
export interface McpToolResult {
	content: Array<{type: 'text'; text: string}>
	isError?: boolean
}

/** A JSON-RPC 2.0 response. */
export interface JsonRpcResponse {
	jsonrpc: '2.0'
	id: string | number | null
	result?: unknown
	error?: {code: number; message: string; data?: unknown}
}

/** Context passed to the JSON-RPC handler with all dependencies. */
export interface HandlerContext {
	tools: McpToolDefinition[]
	config: ResolvedConfig
	executeTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>
}

/** User-facing configuration for McpGraphQLServer. */
export interface McpGraphQLConfig {
	// Schema source (exactly one required)
	schemaPath?: string
	schemaString?: string
	schema?: GraphQLSchema
	introspectionEndpoint?: string

	// Execution
	endpoint: string
	headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)

	// Customization (all optional with sensible defaults)
	serverName?: string
	serverVersion?: string
	toolPrefix?: string
	maxSelectionDepth?: number
	customScalars?: Record<string, JsonSchema>
	operationFilter?: (op: GraphQLOperation) => boolean
	verbose?: boolean
	requestTimeout?: number
	retries?: number
}

/** Internal resolved configuration with defaults applied. */
export interface ResolvedConfig extends McpGraphQLConfig {
	serverName: string
	serverVersion: string
	toolPrefix: string
	maxSelectionDepth: number
	verbose: boolean
	requestTimeout: number
	retries: number
}

/** Apply defaults to user config to produce a ResolvedConfig. */
export function resolveConfig(config: McpGraphQLConfig): ResolvedConfig {
	return {
		...config,
		serverName: config.serverName ?? 'mcp-graphql',
		serverVersion: config.serverVersion ?? '1.0.0',
		toolPrefix: config.toolPrefix ?? 'graphql_',
		maxSelectionDepth: config.maxSelectionDepth ?? 2,
		verbose: config.verbose ?? false,
		requestTimeout: config.requestTimeout ?? 30000,
		retries: config.retries ?? 0,
	}
}

/** Validate that exactly one schema source is provided. */
export function validateConfig(config: McpGraphQLConfig): void {
	const sources = [config.schemaPath, config.schemaString, config.schema, config.introspectionEndpoint].filter(
		s => s !== undefined,
	)
	if (sources.length === 0) {
		throw new Error(
			'McpGraphQLConfig requires exactly one schema source: schemaPath, schemaString, schema, or introspectionEndpoint',
		)
	}
	if (sources.length > 1) {
		throw new Error(
			'McpGraphQLConfig requires exactly one schema source, but multiple were provided: ' +
				[
					config.schemaPath && 'schemaPath',
					config.schemaString && 'schemaString',
					config.schema && 'schema',
					config.introspectionEndpoint && 'introspectionEndpoint',
				]
					.filter(Boolean)
					.join(', '),
		)
	}
	if (!config.endpoint) {
		throw new Error('McpGraphQLConfig requires an endpoint URL')
	}
}
