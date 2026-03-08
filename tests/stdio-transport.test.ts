import {describe, expect, it, vi, afterEach, beforeEach} from 'vitest'
import {join} from 'node:path'
import {PassThrough} from 'node:stream'
import {McpGraphQLServer} from '../src/server.js'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')

describe('stdio transport', () => {
	const originalFetch = globalThis.fetch
	const originalStdin = process.stdin
	const originalStdout = process.stdout

	let stdinMock: PassThrough
	let stdoutChunks: string[]
	let stderrSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		stdinMock = new PassThrough()
		stdoutChunks = []

		// Mock stdin
		Object.defineProperty(process, 'stdin', {value: stdinMock, writable: true, configurable: true})

		// Capture stdout writes
		vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
			stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString())
			return true
		})

		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
		Object.defineProperty(process, 'stdin', {value: originalStdin, writable: true, configurable: true})
		vi.restoreAllMocks()
	})

	async function sendLine(line: string): Promise<void> {
		stdinMock.push(line + '\n')
		// Allow async processing
		await new Promise(resolve => setTimeout(resolve, 50))
	}

	it('starts and logs startup info', async () => {
		const server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		})
		await server.startStdio()

		const stderrOutput = stderrSpy.mock.calls.map(c => c[0]).join('')
		expect(stderrOutput).toContain('running on stdio')
		expect(stderrOutput).toContain('6 tools discovered')
		expect(stderrOutput).toContain('http://localhost:4000/graphql')
	})

	it('handles initialize request', async () => {
		const server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		})
		await server.startStdio()

		await sendLine(JSON.stringify({jsonrpc: '2.0', method: 'initialize', id: 1}))

		expect(stdoutChunks.length).toBeGreaterThan(0)
		const response = JSON.parse(stdoutChunks[0])
		expect(response.result.protocolVersion).toBeDefined()
		expect(response.result.serverInfo.name).toBe('mcp-graphql')
	})

	it('handles tools/list request', async () => {
		const server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		})
		await server.startStdio()

		await sendLine(JSON.stringify({jsonrpc: '2.0', method: 'tools/list', id: 2}))

		const response = JSON.parse(stdoutChunks[0])
		expect(response.result.tools.length).toBe(6)
	})

	it('handles tools/call request', async () => {
		const mockData = {product: {id: '1', title: 'Test'}}
		globalThis.fetch = vi.fn().mockResolvedValue({json: () => Promise.resolve({data: mockData})})

		const server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		})
		await server.startStdio()

		await sendLine(JSON.stringify({
			jsonrpc: '2.0',
			method: 'tools/call',
			params: {name: 'graphql_product', arguments: {id: '1'}},
			id: 3,
		}))

		const response = JSON.parse(stdoutChunks[0])
		expect(response.error).toBeUndefined()
		expect(JSON.parse(response.result.content[0].text)).toEqual(mockData)
	})

	it('handles notifications with no output', async () => {
		const server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		})
		await server.startStdio()

		const countBefore = stdoutChunks.length
		await sendLine(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}))

		// Notifications should not produce stdout output
		expect(stdoutChunks.length).toBe(countBefore)
	})

	it('handles invalid JSON with parse error', async () => {
		const server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		})
		await server.startStdio()

		await sendLine('not valid json{{{')

		const response = JSON.parse(stdoutChunks[0])
		expect(response.error.code).toBe(-32700)
	})

	it('ignores empty lines', async () => {
		const server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		})
		await server.startStdio()

		const countBefore = stdoutChunks.length
		await sendLine('')
		await sendLine('   ')

		expect(stdoutChunks.length).toBe(countBefore)
	})

	it('logs request info to stderr', async () => {
		const server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		})
		await server.startStdio()

		// Clear startup messages
		stderrSpy.mockClear()

		await sendLine(JSON.stringify({jsonrpc: '2.0', method: 'tools/list', id: 5}))

		const stderrOutput = stderrSpy.mock.calls.map(c => c[0]).join('')
		expect(stderrOutput).toContain('tools/list')
	})

	it('logs verbose args when verbose is enabled', async () => {
		const mockData = {product: {id: '1'}}
		globalThis.fetch = vi.fn().mockResolvedValue({json: () => Promise.resolve({data: mockData})})

		const server = new McpGraphQLServer({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
			verbose: true,
		})
		await server.startStdio()
		stderrSpy.mockClear()

		await sendLine(JSON.stringify({
			jsonrpc: '2.0',
			method: 'tools/call',
			params: {name: 'graphql_product', arguments: {id: '1'}},
			id: 6,
		}))

		const stderrOutput = stderrSpy.mock.calls.map(c => c[0]).join('')
		expect(stderrOutput).toContain('graphql_product')
		expect(stderrOutput).toContain('args')
		expect(stderrOutput).toContain('response')
	})
})
