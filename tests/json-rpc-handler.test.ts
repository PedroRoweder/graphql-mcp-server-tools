import {describe, expect, it, vi, afterEach, beforeAll} from 'vitest'
import {join} from 'node:path'
import {handleJsonRpcRequest, createParseError} from '../src/json-rpc-handler.js'
import {loadSchema} from '../src/schema-loader.js'
import {buildTools} from '../src/tool-builder.js'
import {executeGraphQLTool} from '../src/tool-executor.js'
import type {HandlerContext, JsonRpcResponse, McpToolDefinition, ResolvedConfig} from '../src/types.js'
import {resolveConfig} from '../src/types.js'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')

let context: HandlerContext

beforeAll(async () => {
	const config: ResolvedConfig = resolveConfig({
		schemaPath: FIXTURE_PATH,
		endpoint: 'http://localhost:4000/graphql',
	})
	const parsed = await loadSchema(config)
	const tools = buildTools(parsed, config)
	context = {
		tools,
		config,
		executeTool: (name: string, args: Record<string, unknown>) => executeGraphQLTool(name, args, tools, config),
	}
})

function rpc(method: string, params?: unknown, id: string | number = 1) {
	return {jsonrpc: '2.0', method, params, id}
}

describe('json-rpc-handler', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		vi.restoreAllMocks()
	})

	describe('initialize', () => {
		it('returns protocolVersion, serverInfo, and capabilities', async () => {
			const result = (await handleJsonRpcRequest(rpc('initialize'), context)) as JsonRpcResponse
			expect(result.jsonrpc).toBe('2.0')
			expect(result.id).toBe(1)
			expect(result.error).toBeUndefined()

			const res = result.result as Record<string, unknown>
			expect(res.protocolVersion).toBe('2025-03-26')
			expect(res.serverInfo).toEqual({name: 'mcp-graphql', version: '1.0.0'})
			expect(res.capabilities).toEqual({tools: {}})
		})
	})

	describe('notifications/initialized', () => {
		it('returns null for notification', async () => {
			const result = await handleJsonRpcRequest(rpc('notifications/initialized'), context)
			expect(result).toBeNull()
		})
	})

	describe('tools/list', () => {
		it('returns tools with name, description, and inputSchema', async () => {
			const result = (await handleJsonRpcRequest(rpc('tools/list'), context)) as JsonRpcResponse
			expect(result.error).toBeUndefined()

			const res = result.result as {tools: Array<Record<string, unknown>>}
			expect(res.tools).toBeDefined()
			expect(res.tools.length).toBe(6)

			const first = res.tools[0]
			expect(typeof first.name).toBe('string')
			expect(typeof first.description).toBe('string')
			expect(first.inputSchema).toBeDefined()
		})

		it('excludes the document field from tool listings', async () => {
			const result = (await handleJsonRpcRequest(rpc('tools/list'), context)) as JsonRpcResponse
			const res = result.result as {tools: Array<Record<string, unknown>>}
			for (const tool of res.tools) {
				expect(tool.document).toBeUndefined()
			}
		})
	})

	describe('tools/call', () => {
		it('executes a tool and returns the result', async () => {
			const mockData = {product: {id: '1', title: 'Test'}}
			globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({data: mockData})})

			const result = (await handleJsonRpcRequest(
				rpc('tools/call', {name: 'graphql_product', arguments: {id: '1'}}),
				context,
			)) as JsonRpcResponse

			expect(result.error).toBeUndefined()
			const res = result.result as {content: Array<{type: string; text: string}>}
			expect(res.content[0].type).toBe('text')
			expect(JSON.parse(res.content[0].text)).toEqual(mockData)
		})

		it('returns INVALID_PARAMS for missing params', async () => {
			const result = (await handleJsonRpcRequest(rpc('tools/call'), context)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32602)
			expect(result.error?.message).toContain('Missing params')
		})

		it('returns INVALID_PARAMS for missing tool name', async () => {
			const result = (await handleJsonRpcRequest(rpc('tools/call', {}), context)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32602)
		})

		it('returns INVALID_PARAMS for non-object arguments', async () => {
			const result = (await handleJsonRpcRequest(
				rpc('tools/call', {name: 'graphql_product', arguments: 42}),
				context,
			)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32602)
		})

		it('returns INVALID_PARAMS for array arguments', async () => {
			const result = (await handleJsonRpcRequest(
				rpc('tools/call', {name: 'graphql_product', arguments: [1, 2]}),
				context,
			)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32602)
		})

		it('accepts tools/call with no arguments field', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({data: null})})
			const result = (await handleJsonRpcRequest(
				rpc('tools/call', {name: 'graphql_product'}),
				context,
			)) as JsonRpcResponse
			expect(result.error).toBeUndefined()
		})

		it('returns error result for unknown tool', async () => {
			const result = (await handleJsonRpcRequest(
				rpc('tools/call', {name: 'graphql_nonExistent', arguments: {}}),
				context,
			)) as JsonRpcResponse

			expect(result.error).toBeUndefined()
			const res = result.result as {content: Array<{type: string; text: string}>; isError: boolean}
			expect(res.isError).toBe(true)
			expect(res.content[0].text).toContain('Unknown tool')
		})
	})

	describe('unknown method', () => {
		it('returns METHOD_NOT_FOUND', async () => {
			const result = (await handleJsonRpcRequest(rpc('unknown/method'), context)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32601)
			expect(result.error?.message).toContain('unknown/method')
		})
	})

	describe('invalid requests', () => {
		it('returns INVALID_REQUEST with null id for non-object body', async () => {
			const result = (await handleJsonRpcRequest('not an object', context)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32600)
			expect(result.id).toBeNull()
		})

		it('returns INVALID_REQUEST with null id for null body', async () => {
			const result = (await handleJsonRpcRequest(null, context)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32600)
			expect(result.id).toBeNull()
		})

		it('echoes id in INVALID_REQUEST when id is extractable', async () => {
			const result = (await handleJsonRpcRequest({method: 'initialize', id: 7}, context)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32600)
			expect(result.id).toBe(7)
		})

		it('echoes id for missing method field', async () => {
			const result = (await handleJsonRpcRequest({jsonrpc: '2.0', id: 99}, context)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32600)
			expect(result.id).toBe(99)
		})

		it('returns INVALID_REQUEST for non-string/number id', async () => {
			const result = (await handleJsonRpcRequest(
				{jsonrpc: '2.0', method: 'initialize', id: [1, 2]},
				context,
			)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32600)
		})

		it('returns INVALID_REQUEST for object id', async () => {
			const result = (await handleJsonRpcRequest(
				{jsonrpc: '2.0', method: 'initialize', id: {a: 1}},
				context,
			)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32600)
		})

		it('accepts requests without id (notifications)', async () => {
			const result = await handleJsonRpcRequest({jsonrpc: '2.0', method: 'notifications/initialized'}, context)
			expect(result).toBeNull()
		})
	})

	describe('batch requests', () => {
		it('processes batch requests and returns array of responses', async () => {
			const batch = [rpc('initialize', undefined, 1), rpc('tools/list', undefined, 2)]

			const result = (await handleJsonRpcRequest(batch, context)) as JsonRpcResponse[]
			expect(Array.isArray(result)).toBe(true)
			expect(result.length).toBe(2)
			expect(result[0].id).toBe(1)
			expect(result[1].id).toBe(2)
		})

		it('filters out null responses from notifications in batch', async () => {
			const batch = [rpc('initialize', undefined, 1), rpc('notifications/initialized', undefined, 2)]

			const result = (await handleJsonRpcRequest(batch, context)) as JsonRpcResponse[]
			expect(Array.isArray(result)).toBe(true)
			expect(result.length).toBe(1)
			expect(result[0].id).toBe(1)
		})

		it('returns null when batch contains only notifications', async () => {
			const batch = [rpc('notifications/initialized', undefined, 1), rpc('notifications/initialized', undefined, 2)]

			const result = await handleJsonRpcRequest(batch, context)
			expect(result).toBeNull()
		})

		it('returns INVALID_REQUEST for empty batch', async () => {
			const result = (await handleJsonRpcRequest([], context)) as JsonRpcResponse
			expect(result.error?.code).toBe(-32600)
			expect(result.error?.message).toContain('Empty batch')
		})
	})

	describe('createParseError', () => {
		it('returns a PARSE_ERROR response', () => {
			const result = createParseError()
			expect(result.jsonrpc).toBe('2.0')
			expect(result.id).toBeNull()
			expect(result.error?.code).toBe(-32700)
			expect(result.error?.message).toContain('Parse error')
		})
	})
})
