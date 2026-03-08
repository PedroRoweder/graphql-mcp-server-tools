import type {McpGraphQLConfig, McpToolDefinition, McpToolResult} from './types.js'

function isGraphQLResponse(body: unknown): body is {data?: unknown; errors?: unknown} {
	return typeof body === 'object' && body !== null
}

async function resolveHeaders(
	config: McpGraphQLConfig,
): Promise<Record<string, string>> {
	const base: Record<string, string> = {'Content-Type': 'application/json'}
	if (!config.headers) return base
	const custom = typeof config.headers === 'function' ? await config.headers() : config.headers
	return {...base, ...custom}
}

/**
 * Execute an MCP tool call by sending the tool's GraphQL document
 * to the configured endpoint with the provided arguments as GraphQL variables.
 * All errors are returned as `isError: true` results, never thrown.
 */
export async function executeGraphQLTool(
	toolName: string,
	args: Record<string, unknown>,
	tools: McpToolDefinition[],
	config: McpGraphQLConfig,
): Promise<McpToolResult> {
	const tool = tools.find(t => t.name === toolName)
	if (!tool) {
		return {content: [{type: 'text', text: `Unknown tool: ${toolName}`}], isError: true}
	}

	let response: Response
	try {
		const headers = await resolveHeaders(config)
		response = await fetch(config.endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify({query: tool.document, variables: args}),
		})
	} catch (error) {
		return {
			content: [{type: 'text', text: `Network error: ${error instanceof Error ? error.message : String(error)}`}],
			isError: true,
		}
	}

	let body: unknown
	try {
		body = await response.json()
	} catch {
		return {
			content: [{type: 'text', text: `Invalid JSON response from GraphQL endpoint (status ${response.status})`}],
			isError: true,
		}
	}

	if (!isGraphQLResponse(body)) {
		return {content: [{type: 'text', text: 'Unexpected response shape from GraphQL endpoint'}], isError: true}
	}

	if (body.errors) {
		return {
			content: [{type: 'text', text: JSON.stringify({errors: body.errors, data: body.data}, null, 2)}],
			isError: true,
		}
	}

	return {content: [{type: 'text', text: JSON.stringify(body.data ?? null, null, 2)}]}
}
