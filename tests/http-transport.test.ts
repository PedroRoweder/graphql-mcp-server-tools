import {describe, expect, it, vi, afterEach, beforeAll, afterAll} from 'vitest'
import {join} from 'node:path'
import http from 'node:http'
import {McpGraphQLServer} from '../src/server.js'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')

function request(
	port: number,
	options: {method?: string; path?: string; body?: unknown; headers?: Record<string, string>},
): Promise<{status: number; headers: http.IncomingHttpHeaders; body: string}> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: 'localhost',
				port,
				path: options.path ?? '/mcp',
				method: options.method ?? 'POST',
				headers: {
					'Content-Type': 'application/json',
					...options.headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (chunk: Buffer) => chunks.push(chunk))
				res.on('end', () => {
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString('utf-8'),
					})
				})
			},
		)
		req.on('error', reject)
		if (options.body !== undefined) {
			req.write(JSON.stringify(options.body))
		}
		req.end()
	})
}

describe('HTTP transport', () => {
	const originalFetch = globalThis.fetch
	let server: McpGraphQLServer
	const port = 39871 // unlikely to conflict

	beforeAll(async () => {
		vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
		server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		})
		await server.startHttp(port)
		// Wait for server to start listening
		await new Promise((resolve) => setTimeout(resolve, 100))
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	afterAll(() => {
		vi.restoreAllMocks()
	})

	it('returns 404 for wrong path', async () => {
		const res = await request(port, {path: '/wrong'})
		expect(res.status).toBe(404)
		expect(JSON.parse(res.body).error).toContain('/mcp')
	})

	it('returns 204 for OPTIONS (CORS preflight)', async () => {
		const res = await request(port, {method: 'OPTIONS'})
		expect(res.status).toBe(204)
	})

	it('returns 405 for GET (SSE not supported)', async () => {
		const res = await request(port, {method: 'GET'})
		expect(res.status).toBe(405)
		expect(JSON.parse(res.body).error).toContain('SSE')
	})

	it('returns 405 for unsupported methods', async () => {
		const res = await request(port, {method: 'PUT'})
		expect(res.status).toBe(405)
	})

	it('returns 200 for DELETE session termination', async () => {
		const res = await request(port, {method: 'DELETE'})
		expect(res.status).toBe(200)
	})

	it('returns 400 for invalid JSON body', async () => {
		const res = await new Promise<{status: number; body: string}>((resolve, reject) => {
			const req = http.request(
				{hostname: 'localhost', port, path: '/mcp', method: 'POST', headers: {'Content-Type': 'application/json'}},
				(r) => {
					const chunks: Buffer[] = []
					r.on('data', (c: Buffer) => chunks.push(c))
					r.on('end', () => resolve({status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString()}))
				},
			)
			req.on('error', reject)
			req.write('not valid json{{{')
			req.end()
		})
		expect(res.status).toBe(400)
		const parsed = JSON.parse(res.body)
		expect(parsed.error.code).toBe(-32700)
	})

	it('handles initialize and returns session ID', async () => {
		const res = await request(port, {
			body: {jsonrpc: '2.0', method: 'initialize', id: 1},
		})
		expect(res.status).toBe(200)
		expect(res.headers['mcp-session-id']).toBeDefined()
		const parsed = JSON.parse(res.body)
		expect(parsed.result.protocolVersion).toBeDefined()
		expect(parsed.result.serverInfo.name).toBe('mcp-graphql')
	})

	it('handles notifications/initialized with 202', async () => {
		const res = await request(port, {
			body: {jsonrpc: '2.0', method: 'notifications/initialized'},
		})
		expect(res.status).toBe(202)
	})

	it('handles tools/list', async () => {
		const res = await request(port, {
			body: {jsonrpc: '2.0', method: 'tools/list', id: 2},
		})
		expect(res.status).toBe(200)
		const parsed = JSON.parse(res.body)
		expect(parsed.result.tools.length).toBe(6)
	})

	it('handles tools/call', async () => {
		const mockData = {product: {id: '1', title: 'Test'}}
		globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({data: mockData})})

		const res = await request(port, {
			body: {
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {name: 'graphql_product', arguments: {id: '1'}},
				id: 3,
			},
		})
		expect(res.status).toBe(200)
		const parsed = JSON.parse(res.body)
		expect(parsed.error).toBeUndefined()
		expect(JSON.parse(parsed.result.content[0].text)).toEqual(mockData)
	})

	it('sets CORS headers', async () => {
		const res = await request(port, {
			body: {jsonrpc: '2.0', method: 'tools/list', id: 4},
		})
		expect(res.headers['access-control-allow-origin']).toBe('*')
	})

	it('handles DELETE with valid session ID', async () => {
		// First get a session ID via initialize
		const initRes = await request(port, {
			body: {jsonrpc: '2.0', method: 'initialize', id: 10},
		})
		const sessionId = initRes.headers['mcp-session-id'] as string

		// Then delete it
		const deleteRes = await request(port, {
			method: 'DELETE',
			headers: {'Mcp-Session-Id': sessionId},
		})
		expect(deleteRes.status).toBe(200)
	})
})

describe('HTTP transport (verbose)', () => {
	const originalFetch = globalThis.fetch
	let server: McpGraphQLServer
	const verbosePort = 39872

	beforeAll(async () => {
		vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
		server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
			verbose: true,
		})
		await server.startHttp(verbosePort)
		await new Promise((resolve) => setTimeout(resolve, 100))
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	afterAll(() => {
		vi.restoreAllMocks()
	})

	it('logs verbose response data for tool calls', async () => {
		const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

		const mockData = {product: {id: '1', title: 'Verbose Test'}}
		globalThis.fetch = vi.fn().mockResolvedValue({ok: true, json: () => Promise.resolve({data: mockData})})

		const res = await request(verbosePort, {
			body: {
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {name: 'graphql_product', arguments: {id: '1'}},
				id: 1,
			},
		})
		expect(res.status).toBe(200)

		const stderrOutput = stderrSpy.mock.calls.map(c => c[0]).join('')
		expect(stderrOutput).toContain('args')
		expect(stderrOutput).toContain('response')
	})
})
