import {describe, expect, it, vi, afterEach} from 'vitest'
import {join} from 'node:path'
import {McpGraphQLServer} from '../src/server.js'
import type {JsonRpcResponse} from '../src/types.js'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')

describe('McpGraphQLServer', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		vi.restoreAllMocks()
	})

	describe('construction', () => {
		it('creates a server with valid config', () => {
			expect(() => new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				endpoint: 'http://localhost:4000/graphql',
			})).not.toThrow()
		})

		it('throws for missing endpoint', () => {
			expect(() => new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				endpoint: '',
			})).toThrow('endpoint')
		})

		it('throws for missing schema source', () => {
			expect(() => new McpGraphQLServer({
				endpoint: 'http://localhost:4000/graphql',
			} as any)).toThrow('schema source')
		})

		it('throws for multiple schema sources', () => {
			expect(() => new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				schemaString: 'type Query { a: String }',
				endpoint: 'http://localhost:4000/graphql',
			})).toThrow('multiple')
		})
	})

	describe('initialization', () => {
		it('loads schema and builds tools', async () => {
			const server = new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				endpoint: 'http://localhost:4000/graphql',
			})
			await server.initialize()

			const tools = server.getTools()
			expect(tools.length).toBe(6)
			expect(tools[0].name).toMatch(/^graphql_/)
		})

		it('throws getTools() before initialize()', () => {
			const server = new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				endpoint: 'http://localhost:4000/graphql',
			})
			expect(() => server.getTools()).toThrow('not initialized')
		})
	})

	describe('handleRequest', () => {
		it('handles initialize request', async () => {
			const server = new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				endpoint: 'http://localhost:4000/graphql',
				serverName: 'test-server',
			})
			await server.initialize()

			const result = (await server.handleRequest({
				jsonrpc: '2.0',
				method: 'initialize',
				id: 1,
			})) as JsonRpcResponse

			const res = result.result as Record<string, unknown>
			expect((res.serverInfo as any).name).toBe('test-server')
		})

		it('handles tools/list request', async () => {
			const server = new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				endpoint: 'http://localhost:4000/graphql',
			})
			await server.initialize()

			const result = (await server.handleRequest({
				jsonrpc: '2.0',
				method: 'tools/list',
				id: 1,
			})) as JsonRpcResponse

			const res = result.result as {tools: unknown[]}
			expect(res.tools.length).toBe(6)
		})

		it('handles tools/call request', async () => {
			const server = new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				endpoint: 'http://localhost:4000/graphql',
			})
			await server.initialize()

			const mockData = {product: {id: '1'}}
			globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({data: mockData})})

			const result = (await server.handleRequest({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {name: 'graphql_product', arguments: {id: '1'}},
				id: 1,
			})) as JsonRpcResponse

			expect(result.error).toBeUndefined()
			const res = result.result as {content: Array<{text: string}>}
			expect(JSON.parse(res.content[0].text)).toEqual(mockData)
		})
	})

	describe('config defaults', () => {
		it('applies default config values', () => {
			const server = new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				endpoint: 'http://localhost:4000/graphql',
			})
			const config = server.getConfig()
			expect(config.serverName).toBe('mcp-graphql')
			expect(config.serverVersion).toBe('1.0.0')
			expect(config.toolPrefix).toBe('graphql_')
			expect(config.maxSelectionDepth).toBe(2)
			expect(config.requestTimeout).toBe(30000)
			expect(config.retries).toBe(0)
		})

		it('respects custom config values', () => {
			const server = new McpGraphQLServer({
				schemaPath: FIXTURE_PATH,
				endpoint: 'http://localhost:4000/graphql',
				serverName: 'my-server',
				toolPrefix: 'gql_',
				maxSelectionDepth: 3,
				requestTimeout: 10000,
				retries: 3,
			})
			const config = server.getConfig()
			expect(config.serverName).toBe('my-server')
			expect(config.toolPrefix).toBe('gql_')
			expect(config.maxSelectionDepth).toBe(3)
			expect(config.requestTimeout).toBe(10000)
			expect(config.retries).toBe(3)
		})
	})

	describe('empty tool set warning', () => {
		it('warns to stderr when schema produces no tools', async () => {
			const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
			const server = new McpGraphQLServer({
				schemaString: 'type Query { _empty: String }',
				endpoint: 'http://localhost:4000/graphql',
				operationFilter: () => false,
			})
			await server.initialize()

			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining('No tools were generated'),
			)
		})
	})
})
