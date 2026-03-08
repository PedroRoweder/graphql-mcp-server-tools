import {describe, expect, it} from 'vitest'
import {join} from 'node:path'
import {buildTools} from '../src/tool-builder.js'
import {loadSchema} from '../src/schema-loader.js'
import type {McpToolDefinition, ResolvedConfig} from '../src/types.js'
import {resolveConfig} from '../src/types.js'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')
const DEFAULT_CONFIG: ResolvedConfig = resolveConfig({
	schemaPath: FIXTURE_PATH,
	endpoint: 'http://localhost:4000/graphql',
})

async function getTools(configOverrides?: Partial<ResolvedConfig>): Promise<McpToolDefinition[]> {
	const config = {...DEFAULT_CONFIG, ...configOverrides}
	const parsed = await loadSchema(config)
	return buildTools(parsed, config)
}

describe('tool-builder', () => {
	describe('tool naming', () => {
		it('prefixes all tool names with graphql_', async () => {
			const tools = await getTools()
			for (const tool of tools) {
				expect(tool.name.startsWith('graphql_')).toBe(true)
			}
		})

		it('includes known query operation names', async () => {
			const tools = await getTools()
			const names = new Set(tools.map(t => t.name))
			expect(names.has('graphql_product')).toBe(true)
			expect(names.has('graphql_products')).toBe(true)
			expect(names.has('graphql_customer')).toBe(true)
		})

		it('includes known mutation operation names', async () => {
			const tools = await getTools()
			const names = new Set(tools.map(t => t.name))
			expect(names.has('graphql_productCreate')).toBe(true)
			expect(names.has('graphql_productDelete')).toBe(true)
		})

		it('supports custom tool prefix', async () => {
			const tools = await getTools({toolPrefix: 'api_'})
			for (const tool of tools) {
				expect(tool.name.startsWith('api_')).toBe(true)
			}
			const names = new Set(tools.map(t => t.name))
			expect(names.has('api_product')).toBe(true)
		})
	})

	describe('descriptions', () => {
		it('includes descriptions from schema doc comments', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_product')
			expect(tool.description).toBe('Returns a single product by ID.')
		})

		it('includes empty string for operations without descriptions', async () => {
			const tools = await getTools()
			for (const tool of tools) {
				expect(typeof tool.description).toBe('string')
			}
		})
	})

	describe('inputSchema', () => {
		it('has type "object" for all tools', async () => {
			const tools = await getTools()
			for (const tool of tools) {
				expect(tool.inputSchema.type).toBe('object')
			}
		})

		it('includes properties for operations with arguments', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_product')
			expect(tool.inputSchema.properties).toBeDefined()
			expect(tool.inputSchema.required).toContain('id')
		})

		it('includes empty properties for operations without arguments', async () => {
			const tools = await getTools()
			const noArgTools = tools.filter(t => !t.inputSchema.required || t.inputSchema.required.length === 0)
			for (const tool of noArgTools) {
				expect(tool.inputSchema.type).toBe('object')
			}
		})
	})

	describe('document generation', () => {
		it('generates query documents with correct operation keyword', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_product')
			expect(tool.document).toMatch(/^query product\(/)
		})

		it('generates mutation documents with correct operation keyword', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_productCreate')
			expect(tool.document).toMatch(/^mutation productCreate\(/)
		})

		it('includes variable declarations matching arguments', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_product')
			expect(tool.document).toContain('$id: ID!')
		})

		it('includes argument passthrough in field selection', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_product')
			expect(tool.document).toContain('product(id: $id)')
		})

		it('includes multiple variable declarations for multi-arg operations', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_products')
			expect(tool.document).toContain('$first: Int')
			expect(tool.document).toContain('$after: String')
		})

		it('includes userErrors in mutation payload selections', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_productCreate')
			expect(tool.document).toContain('userErrors')
			expect(tool.document).toContain('field')
			expect(tool.document).toContain('message')
		})

		it('includes nodes and pageInfo for connection return types', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_products')
			expect(tool.document).toContain('nodes {')
			expect(tool.document).toContain('pageInfo { hasNextPage hasPreviousPage startCursor endCursor }')
		})

		it('includes scalar fields of the return type', async () => {
			const tools = await getTools()
			const tool = findTool(tools, 'graphql_product')
			expect(tool.document).toContain('id')
			expect(tool.document).toContain('title')
			expect(tool.document).toContain('handle')
		})

		it('wraps non-scalar return types in selection sets', async () => {
			const tools = await getTools()
			for (const tool of tools) {
				expect(tool.document).toContain('{ ')
			}
		})
	})

	describe('operationFilter', () => {
		it('filters operations based on provided predicate', async () => {
			const tools = await getTools({
				operationFilter: op => op.operationType === 'query',
			})
			expect(tools.length).toBe(4)
			for (const tool of tools) {
				expect(tool.document).toMatch(/^query /)
			}
		})

		it('returns all operations when no filter is set', async () => {
			const tools = await getTools()
			expect(tools.length).toBe(6)
		})
	})

	describe('integration', () => {
		it('generates 6 tool definitions from fixture schema', async () => {
			const tools = await getTools()
			expect(tools.length).toBe(6)
		})

		it('generates valid tool definitions for all operations', async () => {
			const tools = await getTools()
			for (const tool of tools) {
				expect(tool.name).toMatch(/^graphql_\w+/)
				expect(typeof tool.description).toBe('string')
				expect(tool.inputSchema.type).toBe('object')
				expect(typeof tool.document).toBe('string')
				expect(tool.document.length).toBeGreaterThan(0)
			}
		})

		it('generates documents starting with query or mutation', async () => {
			const tools = await getTools()
			for (const tool of tools) {
				expect(tool.document).toMatch(/^(query|mutation) /)
			}
		})
	})
})

function findTool(tools: McpToolDefinition[], name: string): McpToolDefinition {
	const tool = tools.find(t => t.name === name)
	if (!tool) throw new Error(`Tool ${name} not found`)
	return tool
}
