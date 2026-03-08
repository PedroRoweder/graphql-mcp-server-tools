import {handleJsonRpcRequest, createParseError} from './json-rpc-handler.js'
import {loadSchema} from './schema-loader.js'
import {buildTools} from './tool-builder.js'
import {executeGraphQLTool} from './tool-executor.js'
import type {
	HandlerContext,
	JsonRpcResponse,
	McpGraphQLConfig,
	McpToolDefinition,
	McpToolResult,
	ParsedSchema,
	ResolvedConfig,
} from './types.js'
import {resolveConfig, validateConfig} from './types.js'

export class McpGraphQLServer {
	private readonly config: ResolvedConfig
	private parsedSchema: ParsedSchema | null = null
	private tools: McpToolDefinition[] | null = null

	constructor(userConfig: McpGraphQLConfig) {
		validateConfig(userConfig)
		this.config = resolveConfig(userConfig)
	}

	/** Load the schema and build tool definitions. Must be called before handling requests. */
	async initialize(): Promise<void> {
		this.parsedSchema = await loadSchema(this.config)
		this.tools = buildTools(this.parsedSchema, this.config)
		if (this.tools.length === 0) {
			process.stderr.write('Warning: No tools were generated from the schema. The schema may have no queries or mutations, or all operations were filtered out.\n')
		}
	}

	/** Get the generated tool definitions. Throws if not initialized. */
	getTools(): McpToolDefinition[] {
		if (!this.tools) {
			throw new Error('Server not initialized. Call initialize() first.')
		}
		return this.tools
	}

	/** Execute a single tool by name. */
	async executeTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
		return executeGraphQLTool(name, args, this.getTools(), this.config)
	}

	/** Handle a parsed JSON-RPC request body. */
	async handleRequest(body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
		const context: HandlerContext = {
			tools: this.getTools(),
			config: this.config,
			executeTool: (name, args) => this.executeTool(name, args),
		}
		return handleJsonRpcRequest(body, context)
	}

	/** Create a JSON-RPC parse error response. */
	createParseError(): JsonRpcResponse {
		return createParseError()
	}

	/** Initialize and start the stdio transport. */
	async startStdio(): Promise<void> {
		await this.initialize()
		const tools = this.getTools()
		process.stderr.write(`MCP server "${this.config.serverName}" running on stdio — ${tools.length} tool${tools.length === 1 ? '' : 's'} discovered\n`)
		process.stderr.write(`GraphQL endpoint: ${this.config.endpoint}\n`)
		const {startStdioTransport} = await import('./transports/stdio.js')
		startStdioTransport(this)
	}

	/** Initialize and start the HTTP transport. */
	async startHttp(port: number = 3000): Promise<void> {
		await this.initialize()
		const tools = this.getTools()
		process.stderr.write(`MCP server "${this.config.serverName}" running on http — ${tools.length} tool${tools.length === 1 ? '' : 's'} discovered\n`)
		process.stderr.write(`GraphQL endpoint: ${this.config.endpoint}\n`)
		const {startHttpTransport} = await import('./transports/http.js')
		startHttpTransport(this, port)
	}

	/** Get the resolved configuration. */
	getConfig(): ResolvedConfig {
		return this.config
	}
}
