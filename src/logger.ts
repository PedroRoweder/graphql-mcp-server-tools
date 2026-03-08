/** ANSI color helpers for terminal output. */
const colors = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
	bold: '\x1b[1m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
	magenta: '\x1b[35m',
	blue: '\x1b[34m',
	white: '\x1b[37m',
} as const

function colorizeStatus(status: number): string {
	if (status < 300) return `${colors.green}${status}${colors.reset}`
	if (status < 400) return `${colors.yellow}${status}${colors.reset}`
	return `${colors.red}${status}${colors.reset}`
}

function timestamp(): string {
	return `${colors.dim}${new Date().toISOString()}${colors.reset}`
}

export interface RequestInfo {
	rpcMethod?: string
	toolName?: string
	toolArgs?: unknown
}

/** Extract JSON-RPC method and tool info from a parsed request body. */
export function extractRequestInfo(body: unknown): RequestInfo {
	if (typeof body !== 'object' || body === null) return {}
	if (!('method' in body) || typeof body.method !== 'string') return {}

	const info: RequestInfo = {rpcMethod: body.method}

	if (body.method === 'tools/call' && 'params' in body && typeof body.params === 'object' && body.params !== null) {
		const params = body.params as Record<string, unknown>
		if (typeof params.name === 'string') {
			info.toolName = params.name
			info.toolArgs = params.arguments
		}
	}

	return info
}

/** Log a single line for an HTTP request with JSON-RPC context. */
export function logHttpRequest(
	httpMethod: string,
	path: string,
	status: number,
	durationMs: number,
	info: RequestInfo,
	verbose?: boolean,
): void {
	const rpcLabel = info.toolName
		? `${colors.magenta}${info.toolName}${colors.reset}`
		: info.rpcMethod
			? `${colors.blue}${info.rpcMethod}${colors.reset}`
			: ''

	const parts = [
		timestamp(),
		`${colors.bold}${colors.cyan}${httpMethod}${colors.reset}`,
		`${colors.white}${path}${colors.reset}`,
		colorizeStatus(status),
		`${colors.dim}${durationMs}ms${colors.reset}`,
	]
	if (rpcLabel) parts.push(rpcLabel)

	process.stderr.write(`${parts.join('  ')}\n`)

	if (verbose && info.toolName) {
		if (info.toolArgs) {
			process.stderr.write(`${colors.dim}  ↳ args: ${JSON.stringify(info.toolArgs, null, 2)}${colors.reset}\n`)
		}
	}
}

/** Log verbose response data (called separately after the request line). */
export function logResponseData(data: unknown): void {
	process.stderr.write(`${colors.dim}  ↳ response: ${JSON.stringify(data, null, 2)}${colors.reset}\n`)
}

/** Log a single line for a stdio request (no HTTP context). */
export function logStdioRequest(info: RequestInfo, durationMs: number, verbose?: boolean): void {
	const rpcLabel = info.toolName
		? `${colors.magenta}${info.toolName}${colors.reset}`
		: info.rpcMethod
			? `${colors.blue}${info.rpcMethod}${colors.reset}`
			: 'unknown'

	process.stderr.write(`${timestamp()}  ${rpcLabel}  ${colors.dim}${durationMs}ms${colors.reset}\n`)

	if (verbose && info.toolName && info.toolArgs) {
		process.stderr.write(`${colors.dim}  ↳ args: ${JSON.stringify(info.toolArgs, null, 2)}${colors.reset}\n`)
	}
}
