import {describe, expect, it, vi, afterEach} from 'vitest'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
import {writeFileSync, unlinkSync} from 'node:fs'

const CLI_PATH = join(import.meta.dirname, '../dist/cli.js')
const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')

function runCli(args: string[], expectFailure = false): string {
	try {
		return execFileSync('node', [CLI_PATH, ...args], {
			encoding: 'utf-8',
			timeout: 5000,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {...process.env},
		})
	} catch (error: any) {
		if (expectFailure) {
			return (error.stdout || '') + (error.stderr || '')
		}
		throw error
	}
}

describe('CLI', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('shows help with --help', () => {
		const output = runCli(['--help'])
		expect(output).toContain('graphql-mcp-server-tools')
		expect(output).toContain('--schema')
		expect(output).toContain('--endpoint')
		expect(output).toContain('--verbose')
	})

	it('shows version with --version', () => {
		const output = runCli(['--version'])
		expect(output.trim()).toMatch(/^\d+\.\d+\.\d+/)
	})

	it('exits with error for missing endpoint', () => {
		const output = runCli(['--schema', FIXTURE_PATH], true)
		expect(output).toContain('--endpoint is required')
	})

	it('exits with error for missing schema source', () => {
		const output = runCli(['--endpoint', 'http://localhost:4000'], true)
		expect(output).toContain('schema source is required')
	})

	it('exits with error for unknown argument', () => {
		const output = runCli(['--unknown-flag'], true)
		expect(output).toContain('Unknown argument')
	})

	it('exits with error for invalid --max-depth', () => {
		const output = runCli([
			'--schema', FIXTURE_PATH,
			'--endpoint', 'http://localhost:4000',
			'--max-depth', 'abc',
		], true)
		expect(output).toContain('--max-depth must be a number')
	})

	it('exits with error for invalid --port', () => {
		const output = runCli([
			'--schema', FIXTURE_PATH,
			'--endpoint', 'http://localhost:4000',
			'--port', 'abc',
		], true)
		expect(output).toContain('--port must be a number')
	})

	it('exits with error for invalid --transport', () => {
		const output = runCli([
			'--schema', FIXTURE_PATH,
			'--endpoint', 'http://localhost:4000',
			'--transport', 'websocket',
		], true)
		expect(output).toContain('--transport must be')
	})

	it('exits with error for invalid --header format', () => {
		const output = runCli([
			'--schema', FIXTURE_PATH,
			'--endpoint', 'http://localhost:4000',
			'--header', 'invalid-no-colon',
		], true)
		expect(output).toContain('--header requires format')
	})

	it('accepts --config with a JSON config file', () => {
		const configPath = join(import.meta.dirname, 'fixtures/test-config.json')
		writeFileSync(configPath, JSON.stringify({
			schemaPath: FIXTURE_PATH,
			endpoint: 'http://localhost:4000/graphql',
		}))

		try {
			// Force stdio so it doesn't try to bind a port; it will timeout waiting for input
			// but it should NOT error on config parsing
			const output = runCli(['--config', configPath, '--transport', 'stdio'], true)
			// Should not contain config-related errors
			expect(output).not.toContain('Error:')
		} finally {
			unlinkSync(configPath)
		}
	})
})
