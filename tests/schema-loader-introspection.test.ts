import {describe, expect, it, vi, afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {buildSchema, introspectionFromSchema} from 'graphql'
import {loadSchema} from '../src/schema-loader.js'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')

describe('schema-loader introspection', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		vi.restoreAllMocks()
	})

	function mockIntrospectionFetch() {
		const sdl = readFileSync(FIXTURE_PATH, 'utf-8')
		const schema = buildSchema(sdl)
		const introspectionResult = introspectionFromSchema(schema)

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({data: introspectionResult}),
		})
	}

	it('loads schema via introspection endpoint', async () => {
		mockIntrospectionFetch()

		const result = await loadSchema({
			introspectionEndpoint: 'http://localhost:4000/graphql',
			endpoint: 'http://localhost:4000/graphql',
		})

		expect(result.operations.length).toBeGreaterThan(0)
		expect(result.schema).toBeDefined()
	})

	it('extracts operations from introspected schema', async () => {
		mockIntrospectionFetch()

		const result = await loadSchema({
			introspectionEndpoint: 'http://localhost:4000/graphql',
			endpoint: 'http://localhost:4000/graphql',
		})

		const queries = result.operations.filter(op => op.operationType === 'query')
		const mutations = result.operations.filter(op => op.operationType === 'mutation')
		expect(queries.length).toBe(4)
		expect(mutations.length).toBe(2)
	})

	it('sends introspection query to the endpoint', async () => {
		mockIntrospectionFetch()

		await loadSchema({
			introspectionEndpoint: 'http://localhost:4000/graphql',
			endpoint: 'http://localhost:4000/graphql',
		})

		expect(globalThis.fetch).toHaveBeenCalledTimes(1)
		const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
		expect(call[0]).toBe('http://localhost:4000/graphql')
		const body = JSON.parse(call[1].body)
		expect(body.query).toContain('__schema')
	})

	it('passes headers to introspection request', async () => {
		mockIntrospectionFetch()

		await loadSchema({
			introspectionEndpoint: 'http://localhost:4000/graphql',
			endpoint: 'http://localhost:4000/graphql',
			headers: {'Authorization': 'Bearer token123'},
		})

		const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
		expect(call[1].headers.Authorization).toBe('Bearer token123')
	})

	it('supports async header function for introspection', async () => {
		mockIntrospectionFetch()

		await loadSchema({
			introspectionEndpoint: 'http://localhost:4000/graphql',
			endpoint: 'http://localhost:4000/graphql',
			headers: async () => ({'Authorization': 'Bearer async-token'}),
		})

		const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
		expect(call[1].headers.Authorization).toBe('Bearer async-token')
	})

	it('throws on non-ok response', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
		})

		await expect(loadSchema({
			introspectionEndpoint: 'http://localhost:4000/graphql',
			endpoint: 'http://localhost:4000/graphql',
		})).rejects.toThrow('status 500')
	})

	it('throws when introspection returns errors', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({errors: [{message: 'Introspection disabled'}]}),
		})

		await expect(loadSchema({
			introspectionEndpoint: 'http://localhost:4000/graphql',
			endpoint: 'http://localhost:4000/graphql',
		})).rejects.toThrow('errors')
	})

	it('throws when introspection returns no data', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({}),
		})

		await expect(loadSchema({
			introspectionEndpoint: 'http://localhost:4000/graphql',
			endpoint: 'http://localhost:4000/graphql',
		})).rejects.toThrow('no data')
	})

	it('throws when no schema source is provided', async () => {
		await expect(loadSchema({
			endpoint: 'http://localhost:4000/graphql',
		} as any)).rejects.toThrow('No schema source')
	})
})
