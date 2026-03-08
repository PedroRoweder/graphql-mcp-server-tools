import {createInterface} from 'node:readline'
import {extractRequestInfo, logResponseData, logStdioRequest} from '../logger.js'
import type {McpGraphQLServer} from '../server.js'

/** Start a stdio-based MCP transport. Reads newline-delimited JSON from stdin, writes responses to stdout. */
export function startStdioTransport(server: McpGraphQLServer): void {
	const verbose = server.getConfig().verbose

	process.stdin.setEncoding('utf-8')

	const rl = createInterface({input: process.stdin, terminal: false})

	rl.on('line', async (line: string) => {
		const trimmed = line.trim()
		if (!trimmed) return

		const start = Date.now()

		let parsed: unknown
		try {
			parsed = JSON.parse(trimmed)
		} catch {
			const error = server.createParseError()
			process.stdout.write(JSON.stringify(error) + '\n')
			return
		}

		const reqInfo = extractRequestInfo(parsed)
		const result = await server.handleRequest(parsed)

		if (result !== null) {
			process.stdout.write(JSON.stringify(result) + '\n')
		}

		logStdioRequest(reqInfo, Date.now() - start, verbose)

		if (verbose && reqInfo.toolName && result && !Array.isArray(result)) {
			logResponseData(result.result ?? result.error)
		}
	})

	rl.on('close', () => {
		process.exit(0)
	})
}
