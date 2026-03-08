import type {HandlerContext, JsonRpcResponse} from './types.js'

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

const PROTOCOL_VERSION = '2025-03-26'

function successResponse(id: string | number | null, result: unknown): JsonRpcResponse {
	return {jsonrpc: '2.0', id, result}
}

function errorResponse(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
	const error: JsonRpcResponse['error'] = {code, message}
	if (data !== undefined) {
		error.data = data
	}
	return {jsonrpc: '2.0', id, error}
}

function isValidRequest(
	body: unknown,
): body is {jsonrpc: string; method: string; id?: string | number; params?: unknown} {
	if (typeof body !== 'object' || body === null) return false
	if (!('jsonrpc' in body) || body.jsonrpc !== '2.0') return false
	if (!('method' in body) || typeof body.method !== 'string') return false
	if ('id' in body && typeof body.id !== 'string' && typeof body.id !== 'number') return false
	return true
}

function handleInitialize(id: string | number | null, context: HandlerContext): JsonRpcResponse {
	return successResponse(id, {
		protocolVersion: PROTOCOL_VERSION,
		serverInfo: {name: context.config.serverName, version: context.config.serverVersion},
		capabilities: {tools: {}},
	})
}

function handleToolsList(id: string | number | null, context: HandlerContext): JsonRpcResponse {
	const tools = context.tools.map(t => ({name: t.name, description: t.description, inputSchema: t.inputSchema}))
	return successResponse(id, {tools})
}

function isToolCallParams(params: unknown): params is {name: string; arguments?: Record<string, unknown>} {
	if (typeof params !== 'object' || params === null) return false
	if (!('name' in params) || typeof params.name !== 'string') return false
	if (
		'arguments' in params &&
		params.arguments !== undefined &&
		(typeof params.arguments !== 'object' || params.arguments === null || Array.isArray(params.arguments))
	) {
		return false
	}
	return true
}

async function handleToolsCall(
	id: string | number | null,
	params: unknown,
	context: HandlerContext,
): Promise<JsonRpcResponse> {
	if (typeof params !== 'object' || params === null) {
		return errorResponse(id, INVALID_PARAMS, 'Missing params for tools/call')
	}

	if (!isToolCallParams(params)) {
		return errorResponse(
			id,
			INVALID_PARAMS,
			'Invalid params: name must be a string and arguments, if provided, must be an object',
		)
	}

	try {
		const result = await context.executeTool(params.name, params.arguments ?? {})
		return successResponse(id, result)
	} catch (error) {
		return errorResponse(id, INTERNAL_ERROR, error instanceof Error ? error.message : 'Tool execution failed')
	}
}

function extractId(body: unknown): string | number | null {
	if (typeof body !== 'object' || body === null) return null
	if (!('id' in body)) return null
	if (typeof body.id === 'string' || typeof body.id === 'number') return body.id
	return null
}

async function processSingleRequest(body: unknown, context: HandlerContext): Promise<JsonRpcResponse | null> {
	if (!isValidRequest(body)) {
		return errorResponse(extractId(body), INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request')
	}

	const id = body.id ?? null

	try {
		switch (body.method) {
			case 'initialize':
				return handleInitialize(id, context)

			case 'notifications/initialized':
				return null

			case 'tools/list':
				return handleToolsList(id, context)

			case 'tools/call':
				return await handleToolsCall(id, body.params, context)

			default:
				return errorResponse(id, METHOD_NOT_FOUND, `Unknown method: ${body.method}`)
		}
	} catch (error) {
		return errorResponse(id, INTERNAL_ERROR, error instanceof Error ? error.message : 'Internal error')
	}
}

/**
 * Handle a parsed JSON-RPC request body (single or batch).
 * Returns a single response, an array of responses, or `null` for notifications.
 */
export async function handleJsonRpcRequest(
	body: unknown,
	context: HandlerContext,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
	if (Array.isArray(body)) {
		if (body.length === 0) {
			return errorResponse(null, INVALID_REQUEST, 'Empty batch request')
		}
		const results = await Promise.all(body.map(item => processSingleRequest(item, context)))
		const responses = results.filter((r): r is JsonRpcResponse => r !== null)
		return responses.length > 0 ? responses : null
	}

	return processSingleRequest(body, context)
}

/** Create a JSON-RPC parse error response for malformed JSON. */
export function createParseError(): JsonRpcResponse {
	return errorResponse(null, PARSE_ERROR, 'Parse error: invalid JSON')
}
