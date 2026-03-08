import {describe, expect, it, vi, afterEach, beforeAll} from 'vitest'
import {join} from 'node:path'
import {executeGraphQLTool} from '../src/tool-executor.js'
import {loadSchema} from '../src/schema-loader.js'
import {buildTools} from '../src/tool-builder.js'
import type {McpGraphQLConfig, McpToolDefinition, ResolvedConfig} from '../src/types.js'
import {resolveConfig} from '../src/types.js'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')
const ENDPOINT = 'http://localhost:4000/graphql'

let tools: McpToolDefinition[]
let config: ResolvedConfig

beforeAll(async () => {
	config = resolveConfig({schemaPath: FIXTURE_PATH, endpoint: ENDPOINT})
	const parsed = await loadSchema(config)
	tools = buildTools(parsed, config)
})

describe('tool-executor', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		vi.restoreAllMocks()
	})

	describe('tool lookup', () => {
		it('returns error for unknown tool name', async () => {
			const result = await executeGraphQLTool('graphql_nonExistentTool', {}, tools, config)
			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('Unknown tool')
			expect(result.content[0].text).toContain('graphql_nonExistentTool')
		})
	})

	describe('successful execution', () => {
		it('formats GraphQL data as JSON text', async () => {
			const mockData = {product: {id: '1', title: 'Test Product'}}
			globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({data: mockData})})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(result.isError).toBeUndefined()
			expect(result.content[0].type).toBe('text')
			expect(JSON.parse(result.content[0].text)).toEqual(mockData)
		})

		it('sends correct request to configured endpoint', async () => {
			const fetchMock = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({data: {}})})
			globalThis.fetch = fetchMock

			await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(fetchMock).toHaveBeenCalledOnce()
			const [url, options] = fetchMock.mock.calls[0]
			expect(url).toBe(ENDPOINT)
			expect(options.method).toBe('POST')
			expect(options.headers['Content-Type']).toBe('application/json')

			const body = JSON.parse(options.body)
			expect(body.query).toContain('query product')
			expect(body.variables).toEqual({id: '1'})
		})

		it('includes custom headers from config', async () => {
			const fetchMock = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({data: {}})})
			globalThis.fetch = fetchMock

			const customConfig: McpGraphQLConfig = {
				...config,
				headers: {'Authorization': 'Bearer test-token', 'X-Custom': 'value'},
			}

			await executeGraphQLTool('graphql_product', {id: '1'}, tools, customConfig)

			const [, options] = fetchMock.mock.calls[0]
			expect(options.headers['Authorization']).toBe('Bearer test-token')
			expect(options.headers['X-Custom']).toBe('value')
			expect(options.headers['Content-Type']).toBe('application/json')
		})

		it('supports async header function', async () => {
			const fetchMock = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({data: {}})})
			globalThis.fetch = fetchMock

			const customConfig: McpGraphQLConfig = {
				...config,
				headers: async () => ({Authorization: 'Bearer dynamic-token'}),
			}

			await executeGraphQLTool('graphql_product', {id: '1'}, tools, customConfig)

			const [, options] = fetchMock.mock.calls[0]
			expect(options.headers['Authorization']).toBe('Bearer dynamic-token')
		})
	})

	describe('response without data', () => {
		it('returns valid string content when response has no data field', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({})})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(result.isError).toBeUndefined()
			expect(typeof result.content[0].text).toBe('string')
			expect(result.content[0].text).toBe('null')
		})
	})

	describe('GraphQL errors', () => {
		it('returns isError for full GraphQL errors', async () => {
			globalThis.fetch = vi
				.fn()
				.mockResolvedValue({ok: true, json: () => Promise.resolve({errors: [{message: 'Product not found'}], data: null})})

			const result = await executeGraphQLTool('graphql_product', {id: 'bad-id'}, tools, config)

			expect(result.isError).toBe(true)
			const parsed = JSON.parse(result.content[0].text)
			expect(parsed.errors).toBeDefined()
			expect(parsed.errors[0].message).toBe('Product not found')
		})

		it('returns isError for partial data with errors', async () => {
			globalThis.fetch = vi
				.fn()
				.mockResolvedValue({
					ok: true,
					json: () => Promise.resolve({data: {product: {id: '1'}}, errors: [{message: 'Some field failed'}]}),
				})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(result.isError).toBe(true)
			const parsed = JSON.parse(result.content[0].text)
			expect(parsed.data).toBeDefined()
			expect(parsed.errors).toBeDefined()
		})
	})

	describe('HTTP error responses', () => {
		it('returns isError for non-200 HTTP status', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				text: () => Promise.resolve('Something went wrong'),
			})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('HTTP 500')
			expect(result.content[0].text).toContain('Something went wrong')
		})

		it('returns statusText when body is empty for non-200', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
				statusText: 'Forbidden',
				text: () => Promise.resolve(''),
			})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('HTTP 403')
			expect(result.content[0].text).toContain('Forbidden')
		})

		it('handles text() failure on non-200 response', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 502,
				statusText: 'Bad Gateway',
				text: () => Promise.reject(new Error('read error')),
			})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('HTTP 502')
			expect(result.content[0].text).toContain('Bad Gateway')
		})
	})

	describe('network failures', () => {
		it('catches fetch errors and returns isError', async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('Network error')
			expect(result.content[0].text).toContain('Connection refused')
		})

		it('handles invalid JSON response', async () => {
			globalThis.fetch = vi
				.fn()
				.mockResolvedValue({ok: true, status: 200, json: () => Promise.reject(new Error('Invalid JSON'))})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('Invalid JSON response')
			expect(result.content[0].text).toContain('200')
		})
	})

	describe('timeout', () => {
		it('returns timeout error with endpoint URL and duration', async () => {
			const abortError = new Error('The operation was aborted')
			abortError.name = 'AbortError'
			globalThis.fetch = vi.fn().mockRejectedValue(abortError)

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, config)

			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('timed out')
			expect(result.content[0].text).toContain(ENDPOINT)
			expect(result.content[0].text).toContain('30000ms')
		})

		it('uses custom requestTimeout from config', async () => {
			const abortError = new Error('The operation was aborted')
			abortError.name = 'AbortError'
			globalThis.fetch = vi.fn().mockRejectedValue(abortError)

			const customConfig = resolveConfig({schemaPath: FIXTURE_PATH, endpoint: ENDPOINT, requestTimeout: 5000})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, customConfig)

			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('5000ms')
		})
	})

	describe('retry', () => {
		it('retries on failure and succeeds on subsequent attempt', async () => {
			const fetchMock = vi.fn()
				.mockRejectedValueOnce(new Error('Connection reset'))
				.mockResolvedValueOnce({ok: true, json: () => Promise.resolve({data: {product: {id: '1'}}})})
			globalThis.fetch = fetchMock

			const retryConfig = resolveConfig({schemaPath: FIXTURE_PATH, endpoint: ENDPOINT, retries: 1, requestTimeout: 1000})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, retryConfig)

			expect(result.isError).toBeUndefined()
			expect(fetchMock).toHaveBeenCalledTimes(2)
		})

		it('returns error after exhausting all retries', async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

			const retryConfig = resolveConfig({schemaPath: FIXTURE_PATH, endpoint: ENDPOINT, retries: 2, requestTimeout: 1000})

			const result = await executeGraphQLTool('graphql_product', {id: '1'}, tools, retryConfig)

			expect(result.isError).toBe(true)
			expect(result.content[0].text).toContain('Connection refused')
			expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3)
		})
	})
})
