import {describe, expect, it, vi, afterEach, beforeEach} from 'vitest'
import {extractRequestInfo, logHttpRequest, logResponseData, logStdioRequest} from '../src/logger.js'

describe('logger', () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('extractRequestInfo', () => {
		it('returns empty object for non-object body', () => {
			expect(extractRequestInfo(null)).toEqual({})
			expect(extractRequestInfo('string')).toEqual({})
			expect(extractRequestInfo(42)).toEqual({})
		})

		it('returns empty object when method is missing or not a string', () => {
			expect(extractRequestInfo({})).toEqual({})
			expect(extractRequestInfo({method: 123})).toEqual({})
		})

		it('extracts rpcMethod for non-tool-call methods', () => {
			expect(extractRequestInfo({method: 'initialize'})).toEqual({rpcMethod: 'initialize'})
			expect(extractRequestInfo({method: 'tools/list'})).toEqual({rpcMethod: 'tools/list'})
		})

		it('extracts toolName and toolArgs for tools/call', () => {
			const body = {
				method: 'tools/call',
				params: {name: 'graphql_product', arguments: {id: '1'}},
			}
			expect(extractRequestInfo(body)).toEqual({
				rpcMethod: 'tools/call',
				toolName: 'graphql_product',
				toolArgs: {id: '1'},
			})
		})

		it('extracts toolName without arguments', () => {
			const body = {
				method: 'tools/call',
				params: {name: 'graphql_products'},
			}
			const info = extractRequestInfo(body)
			expect(info.toolName).toBe('graphql_products')
			expect(info.toolArgs).toBeUndefined()
		})

		it('handles tools/call with missing params', () => {
			expect(extractRequestInfo({method: 'tools/call'})).toEqual({rpcMethod: 'tools/call'})
		})

		it('handles tools/call with non-object params', () => {
			expect(extractRequestInfo({method: 'tools/call', params: 'bad'})).toEqual({rpcMethod: 'tools/call'})
		})

		it('handles tools/call with params missing name', () => {
			expect(extractRequestInfo({method: 'tools/call', params: {arguments: {}}})).toEqual({rpcMethod: 'tools/call'})
		})

		it('handles tools/call with non-string name', () => {
			expect(extractRequestInfo({method: 'tools/call', params: {name: 123}})).toEqual({rpcMethod: 'tools/call'})
		})
	})

	describe('logHttpRequest', () => {
		it('writes a single log line to stderr', () => {
			logHttpRequest('POST', '/mcp', 200, 5, {rpcMethod: 'initialize'})
			expect(stderrSpy).toHaveBeenCalledTimes(1)
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('POST')
			expect(output).toContain('/mcp')
			expect(output).toContain('200')
			expect(output).toContain('5ms')
			expect(output).toContain('initialize')
		})

		it('shows tool name instead of rpcMethod for tool calls', () => {
			logHttpRequest('POST', '/mcp', 200, 10, {rpcMethod: 'tools/call', toolName: 'graphql_product'})
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('graphql_product')
		})

		it('works without request info', () => {
			logHttpRequest('GET', '/mcp', 405, 1, {})
			expect(stderrSpy).toHaveBeenCalledTimes(1)
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('GET')
			expect(output).toContain('405')
		})

		it('does not log args when verbose is false', () => {
			logHttpRequest('POST', '/mcp', 200, 5, {
				toolName: 'graphql_product',
				toolArgs: {id: '1'},
			})
			expect(stderrSpy).toHaveBeenCalledTimes(1)
		})

		it('logs args when verbose is true and tool has args', () => {
			logHttpRequest('POST', '/mcp', 200, 5, {
				toolName: 'graphql_product',
				toolArgs: {id: '1'},
			}, true)
			expect(stderrSpy).toHaveBeenCalledTimes(2)
			const argsOutput = stderrSpy.mock.calls[1][0] as string
			expect(argsOutput).toContain('args')
			expect(argsOutput).toContain('"id"')
		})

		it('does not log args line when verbose is true but no toolArgs', () => {
			logHttpRequest('POST', '/mcp', 200, 5, {
				toolName: 'graphql_products',
			}, true)
			expect(stderrSpy).toHaveBeenCalledTimes(1)
		})

		it('does not log args when verbose is true but no toolName', () => {
			logHttpRequest('POST', '/mcp', 200, 5, {rpcMethod: 'tools/list'}, true)
			expect(stderrSpy).toHaveBeenCalledTimes(1)
		})

		it('colorizes 2xx status with green', () => {
			logHttpRequest('POST', '/mcp', 200, 1, {})
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('\x1b[32m200')
		})

		it('colorizes 3xx status with yellow', () => {
			logHttpRequest('GET', '/mcp', 301, 1, {})
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('\x1b[33m301')
		})

		it('colorizes 4xx+ status with red', () => {
			logHttpRequest('GET', '/mcp', 404, 1, {})
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('\x1b[31m404')
		})
	})

	describe('logResponseData', () => {
		it('writes response data to stderr', () => {
			logResponseData({content: [{type: 'text', text: 'hello'}]})
			expect(stderrSpy).toHaveBeenCalledTimes(1)
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('response')
			expect(output).toContain('hello')
		})
	})

	describe('logStdioRequest', () => {
		it('writes a log line with rpcMethod', () => {
			logStdioRequest({rpcMethod: 'initialize'}, 3)
			expect(stderrSpy).toHaveBeenCalledTimes(1)
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('initialize')
			expect(output).toContain('3ms')
		})

		it('shows tool name for tool calls', () => {
			logStdioRequest({rpcMethod: 'tools/call', toolName: 'graphql_product'}, 10)
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('graphql_product')
		})

		it('shows "unknown" when no request info', () => {
			logStdioRequest({}, 1)
			const output = stderrSpy.mock.calls[0][0] as string
			expect(output).toContain('unknown')
		})

		it('logs args when verbose and tool has args', () => {
			logStdioRequest({toolName: 'graphql_product', toolArgs: {id: '1'}}, 5, true)
			expect(stderrSpy).toHaveBeenCalledTimes(2)
			const argsOutput = stderrSpy.mock.calls[1][0] as string
			expect(argsOutput).toContain('args')
		})

		it('does not log args when verbose but no toolArgs', () => {
			logStdioRequest({toolName: 'graphql_product'}, 5, true)
			expect(stderrSpy).toHaveBeenCalledTimes(1)
		})

		it('does not log args when not verbose', () => {
			logStdioRequest({toolName: 'graphql_product', toolArgs: {id: '1'}}, 5, false)
			expect(stderrSpy).toHaveBeenCalledTimes(1)
		})
	})
})
