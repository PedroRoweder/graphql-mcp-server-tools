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

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		return await fetch(url, {...init, signal: controller.signal})
	} finally {
		clearTimeout(timer)
	}
}

async function fetchWithRetry(
	url: string,
	init: RequestInit,
	timeoutMs: number,
	retries: number,
): Promise<Response> {
	let lastError: unknown
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fetchWithTimeout(url, init, timeoutMs)
		} catch (error) {
			lastError = error
			if (attempt < retries) {
				await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
			}
		}
	}
	throw lastError
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

	const timeoutMs = config.requestTimeout ?? 30000
	const retries = config.retries ?? 0

	let response: Response
	try {
		const headers = await resolveHeaders(config)
		response = await fetchWithRetry(
			config.endpoint,
			{
				method: 'POST',
				headers,
				body: JSON.stringify({query: tool.document, variables: args}),
			},
			timeoutMs,
			retries,
		)
	} catch (error) {
		const message = error instanceof Error
			? error.name === 'AbortError'
				? `Request to ${config.endpoint} timed out after ${timeoutMs}ms`
				: error.message
			: String(error)
		return {
			content: [{type: 'text', text: `Network error: ${message}`}],
			isError: true,
		}
	}

	if (!response.ok) {
		let bodyText: string
		try {
			bodyText = await response.text()
		} catch {
			bodyText = ''
		}
		return {
			content: [{type: 'text', text: `GraphQL endpoint returned HTTP ${response.status}: ${bodyText || response.statusText}`}],
			isError: true,
		}
	}

	let body: unknown
	try {
		body = await response.json()
	} catch {
		return {
			content: [{type: 'text', text: `Invalid JSON response from GraphQL endpoint (HTTP ${response.status})`}],
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
