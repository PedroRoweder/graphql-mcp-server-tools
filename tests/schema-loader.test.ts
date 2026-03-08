import {describe, expect, it} from 'vitest'
import {join} from 'node:path'
import {readFileSync} from 'node:fs'
import {buildSchema, isNonNullType, isNamedType} from 'graphql'
import {loadSchema} from '../src/schema-loader.js'
import type {GraphQLOperation, ParsedSchema} from '../src/types.js'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')
const FIXTURE_SDL = readFileSync(FIXTURE_PATH, 'utf-8')

describe('schema-loader', () => {
	describe('schemaPath source', () => {
		let parsed: ParsedSchema

		it('loads schema from file path', async () => {
			parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			expect(parsed.schema).toBeDefined()
			expect(parsed.operations.length).toBeGreaterThan(0)
		})
	})

	describe('schemaString source', () => {
		it('loads schema from SDL string', async () => {
			const parsed = await loadSchema({schemaString: FIXTURE_SDL, endpoint: 'http://localhost:4000/graphql'})
			expect(parsed.schema).toBeDefined()
			expect(parsed.operations.length).toBeGreaterThan(0)
		})
	})

	describe('schema object source', () => {
		it('loads schema from a GraphQLSchema object', async () => {
			const schema = buildSchema(FIXTURE_SDL)
			const parsed = await loadSchema({schema, endpoint: 'http://localhost:4000/graphql'})
			expect(parsed.schema).toBe(schema)
			expect(parsed.operations.length).toBeGreaterThan(0)
		})
	})

	describe('operation extraction', () => {
		let parsed: ParsedSchema

		it('extracts queries and mutations', async () => {
			parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			const queries = parsed.operations.filter(op => op.operationType === 'query')
			const mutations = parsed.operations.filter(op => op.operationType === 'mutation')

			expect(queries.length).toBe(4) // product, products, customer, events
			expect(mutations.length).toBe(2) // productCreate, productDelete
			expect(parsed.operations.length).toBe(6)
		})

		it('contains known query operations', async () => {
			parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			const names = new Set(parsed.operations.filter(op => op.operationType === 'query').map(op => op.name))

			expect(names.has('product')).toBe(true)
			expect(names.has('products')).toBe(true)
			expect(names.has('customer')).toBe(true)
			expect(names.has('events')).toBe(true)
		})

		it('contains known mutation operations', async () => {
			parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			const names = new Set(parsed.operations.filter(op => op.operationType === 'mutation').map(op => op.name))

			expect(names.has('productCreate')).toBe(true)
			expect(names.has('productDelete')).toBe(true)
		})
	})

	describe('operation fields', () => {
		it('each operation has required fields', async () => {
			const parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			for (const op of parsed.operations) {
				expect(typeof op.name).toBe('string')
				expect(op.name.length).toBeGreaterThan(0)
				expect(['query', 'mutation']).toContain(op.operationType)
				expect(Array.isArray(op.args)).toBe(true)
				expect(op.returnType).toBeDefined()
			}
		})

		it('operations have descriptions from schema doc comments', async () => {
			const parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			const product = parsed.operations.find(op => op.name === 'product' && op.operationType === 'query')
			expect(product).toBeDefined()
			expect(product!.description).toBe('Returns a single product by ID.')
		})

		it('extracts arguments for operations that have them', async () => {
			const parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			const product = findOperation(parsed.operations, 'product', 'query')
			expect(product.args.length).toBeGreaterThan(0)

			const idArg = product.args.find(a => a.name === 'id')
			expect(idArg).toBeDefined()
			expect(isNonNullType(idArg!.type)).toBe(true)

			const innerType = isNonNullType(idArg!.type) ? idArg!.type.ofType : idArg!.type
			expect(isNamedType(innerType)).toBe(true)
			if (isNamedType(innerType)) {
				expect(innerType.name).toBe('ID')
			}
		})
	})

	describe('error handling', () => {
		it('throws when no schema source is provided', async () => {
			await expect(
				loadSchema({endpoint: 'http://localhost:4000/graphql'} as any),
			).rejects.toThrow('No schema source provided')
		})

		it('throws for invalid file path', async () => {
			await expect(
				loadSchema({schemaPath: '/nonexistent/schema.graphql', endpoint: 'http://localhost:4000/graphql'}),
			).rejects.toThrow()
		})

		it('throws for invalid SDL string', async () => {
			await expect(
				loadSchema({schemaString: 'not valid graphql', endpoint: 'http://localhost:4000/graphql'}),
			).rejects.toThrow()
		})
	})
})

function findOperation(operations: GraphQLOperation[], name: string, type: 'query' | 'mutation'): GraphQLOperation {
	const op = operations.find(o => o.name === name && o.operationType === type)
	if (!op) throw new Error(`Operation ${type} ${name} not found`)
	return op
}
