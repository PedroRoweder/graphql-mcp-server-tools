import {createServer, type IncomingMessage, type ServerResponse} from 'node:http'
import {randomUUID} from 'node:crypto'
import {extractRequestInfo, logHttpRequest, logResponseData, type RequestInfo} from '../logger.js'
import type {McpGraphQLServer} from '../server.js'

/** Start an HTTP-based MCP transport using the Streamable HTTP spec (2025-03-26). */
export function startHttpTransport(server: McpGraphQLServer, port: number): void {
	const sessions = new Set<string>()

	const mcpPath = '/mcp'

	const verbose = server.getConfig().verbose

	const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		const start = Date.now()
		const httpMethod = req.method || 'UNKNOWN'
		const url = new URL(req.url || '/', `http://localhost:${port}`)
		const path = url.pathname
		let reqInfo: RequestInfo = {}

		function respond(status: number, body?: string, headers?: Record<string, string>): void {
			if (headers) {
				for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
			}
			res.writeHead(status, body ? {'Content-Type': 'application/json'} : undefined)
			res.end(body)
			logHttpRequest(httpMethod, path, status, Date.now() - start, reqInfo, verbose)
		}

		// CORS headers
		res.setHeader('Access-Control-Allow-Origin', '*')
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id')
		res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')

		// Only handle requests to /mcp
		if (path !== mcpPath) {
			respond(404, JSON.stringify({error: `Not found. MCP endpoint is ${mcpPath}`}))
			return
		}

		if (httpMethod === 'OPTIONS') {
			respond(204)
			return
		}

		if (httpMethod === 'GET') {
			respond(405, JSON.stringify({error: 'SSE stream not supported. Use POST to send JSON-RPC requests.'}))
			return
		}

		if (httpMethod === 'DELETE') {
			const sessionId = req.headers['mcp-session-id'] as string | undefined
			if (sessionId && sessions.has(sessionId)) {
				sessions.delete(sessionId)
			}
			respond(200)
			return
		}

		if (httpMethod !== 'POST') {
			respond(405, JSON.stringify({error: 'Method not allowed'}))
			return
		}

		// --- POST: handle JSON-RPC request ---

		const body = await readBody(req)
		if (body === null) {
			respond(400, JSON.stringify(server.createParseError()))
			return
		}

		let parsed: unknown
		try {
			parsed = JSON.parse(body)
		} catch {
			respond(400, JSON.stringify(server.createParseError()))
			return
		}

		reqInfo = extractRequestInfo(parsed)

		const result = await server.handleRequest(parsed)

		// Notifications return null — respond with 202 Accepted
		if (result === null) {
			respond(202)
			return
		}

		// Check if this is an initialize response — assign session ID
		const isInitialize = !Array.isArray(result) && result.result && typeof result.result === 'object' && 'protocolVersion' in (result.result as Record<string, unknown>)

		const extraHeaders: Record<string, string> = {}
		if (isInitialize) {
			const sessionId = randomUUID()
			sessions.add(sessionId)
			extraHeaders['Mcp-Session-Id'] = sessionId
		}

		respond(200, JSON.stringify(result), extraHeaders)

		if (verbose && reqInfo.toolName && result && !Array.isArray(result)) {
			logResponseData(result.result ?? result.error)
		}
	})

	httpServer.listen(port, () => {
		process.stderr.write(`MCP endpoint: http://localhost:${port}/mcp\n`)
	})
}

function readBody(req: IncomingMessage): Promise<string | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => chunks.push(chunk))
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
		req.on('error', () => resolve(null))
	})
}
