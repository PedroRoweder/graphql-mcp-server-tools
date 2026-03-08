import {describe, expect, it} from 'vitest'
import {buildSchema, isNonNullType, type GraphQLNonNull, type GraphQLList, type GraphQLScalarType} from 'graphql'
import {graphqlTypeToJsonSchema, graphqlArgsToInputSchema} from '../src/type-converter.js'
import {loadSchema} from '../src/schema-loader.js'
import {join} from 'node:path'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/test-schema.graphql')

describe('type-converter', () => {
	describe('standard scalars', () => {
		const schema = buildSchema(`
			type Query {
				s: String
				i: Int
				f: Float
				b: Boolean
				id: ID
			}
		`)
		const fields = schema.getQueryType()!.getFields()

		it('maps String to {type:"string"}', () => {
			expect(graphqlTypeToJsonSchema(fields.s.type)).toEqual({type: 'string'})
		})

		it('maps Int to {type:"integer"}', () => {
			expect(graphqlTypeToJsonSchema(fields.i.type)).toEqual({type: 'integer'})
		})

		it('maps Float to {type:"number"}', () => {
			expect(graphqlTypeToJsonSchema(fields.f.type)).toEqual({type: 'number'})
		})

		it('maps Boolean to {type:"boolean"}', () => {
			expect(graphqlTypeToJsonSchema(fields.b.type)).toEqual({type: 'boolean'})
		})

		it('maps ID to {type:"string"}', () => {
			expect(graphqlTypeToJsonSchema(fields.id.type)).toEqual({type: 'string'})
		})
	})

	describe('custom scalars via config', () => {
		const schema = buildSchema(`
			scalar DateTime
			scalar Money
			scalar JSON

			type Query {
				dt: DateTime
				m: Money
				j: JSON
			}
		`)
		const fields = schema.getQueryType()!.getFields()

		it('unknown scalars default to string with description', () => {
			expect(graphqlTypeToJsonSchema(fields.dt.type)).toEqual({type: 'string', description: 'DateTime'})
		})

		it('custom scalar mappings override defaults', () => {
			const customScalars = {
				Money: {type: 'number', description: 'Amount in cents'},
				JSON: {type: 'object', description: 'Arbitrary JSON'},
			}
			expect(graphqlTypeToJsonSchema(fields.m.type, customScalars)).toEqual({
				type: 'number',
				description: 'Amount in cents',
			})
			expect(graphqlTypeToJsonSchema(fields.j.type, customScalars)).toEqual({
				type: 'object',
				description: 'Arbitrary JSON',
			})
		})

		it('custom scalars do not affect standard scalars', () => {
			const standardSchema = buildSchema(`type Query { n: Int }`)
			const f = standardSchema.getQueryType()!.getFields()
			expect(graphqlTypeToJsonSchema(f.n.type, {Int: {type: 'string'}})).toEqual({type: 'string'})
		})
	})

	describe('enum types', () => {
		const schema = buildSchema(`
			enum Color { RED GREEN BLUE }
			type Query { c: Color }
		`)
		const fields = schema.getQueryType()!.getFields()

		it('maps enum to {type:"string", enum:[...]}', () => {
			expect(graphqlTypeToJsonSchema(fields.c.type)).toEqual({type: 'string', enum: ['RED', 'GREEN', 'BLUE']})
		})
	})

	describe('input object types', () => {
		const schema = buildSchema(`
			input AddressInput {
				street: String!
				city: String!
				zip: String
			}
			type Query { q(addr: AddressInput!): String }
		`)
		const fields = schema.getQueryType()!.getFields()
		const addrType = fields.q.args[0].type

		it('maps input object to nested JSON Schema', () => {
			const result = graphqlTypeToJsonSchema(addrType)
			expect(result).toEqual({
				type: 'object',
				properties: {street: {type: 'string'}, city: {type: 'string'}, zip: {type: 'string'}},
				required: ['street', 'city'],
			})
		})
	})

	describe('NonNull wrapper', () => {
		const schema = buildSchema(`
			type Query { name: String! }
		`)
		const fields = schema.getQueryType()!.getFields()

		it('unwraps NonNull to produce the inner type schema', () => {
			expect(graphqlTypeToJsonSchema(fields.name.type)).toEqual({type: 'string'})
		})

		it('isNonNullType returns true for NonNull', () => {
			expect(isNonNullType(fields.name.type as GraphQLNonNull<GraphQLScalarType>)).toBe(true)
		})
	})

	describe('List wrapper', () => {
		const schema = buildSchema(`
			type Query { tags: [String] }
		`)
		const fields = schema.getQueryType()!.getFields()

		it('maps List to {type:"array", items:{...}}', () => {
			expect(graphqlTypeToJsonSchema(fields.tags.type)).toEqual({type: 'array', items: {type: 'string'}})
		})
	})

	describe('nested wrappers [Type!]!', () => {
		const schema = buildSchema(`
			type Query { ids: [ID!]! }
		`)
		const fields = schema.getQueryType()!.getFields()

		it('unwraps NonNull(List(NonNull(ID))) correctly', () => {
			expect(graphqlTypeToJsonSchema(fields.ids.type)).toEqual({type: 'array', items: {type: 'string'}})
		})

		it('marks the outer type as required', () => {
			expect(isNonNullType(fields.ids.type as GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLScalarType>>>)).toBe(
				true,
			)
		})
	})

	describe('circular/recursive input types', () => {
		const schema = buildSchema(`
			input TreeNode {
				value: String!
				children: [TreeNode!]
			}
			type Query { root(input: TreeNode!): String }
		`)
		const fields = schema.getQueryType()!.getFields()

		it('handles recursive types without infinite loop', () => {
			const result = graphqlTypeToJsonSchema(fields.root.args[0].type)
			expect(result.type).toBe('object')
			expect(result.properties?.value).toEqual({type: 'string'})
			expect(result.properties?.children).toEqual({
				type: 'array',
				items: {type: 'object', description: 'Recursive reference to TreeNode'},
			})
		})
	})

	describe('scalar map immutability', () => {
		it('does not mutate shared scalar maps when descriptions are set', () => {
			const schema = buildSchema(`
				type Query {
					find(
						"""First identifier."""
						id1: ID!
						"""Second identifier."""
						id2: ID!
					): String
				}
			`)
			const args = schema.getQueryType()!.getFields().find.args

			const first = graphqlArgsToInputSchema(args)
			const second = graphqlArgsToInputSchema(args)

			expect(first.properties?.id1?.description).toBe('First identifier.')
			expect(first.properties?.id2?.description).toBe('Second identifier.')
			expect(second.properties?.id1?.description).toBe('First identifier.')
			expect(second.properties?.id2?.description).toBe('Second identifier.')
		})
	})

	describe('graphqlArgsToInputSchema', () => {
		it('returns empty object schema for no args', () => {
			expect(graphqlArgsToInputSchema([])).toEqual({type: 'object', properties: {}})
		})

		it('converts args with required/optional correctly', () => {
			const schema = buildSchema(`
				type Query {
					find(id: ID!, name: String, limit: Int): String
				}
			`)
			const args = schema.getQueryType()!.getFields().find.args

			const result = graphqlArgsToInputSchema(args)
			expect(result).toEqual({
				type: 'object',
				properties: {id: {type: 'string'}, name: {type: 'string'}, limit: {type: 'integer'}},
				required: ['id'],
			})
		})

		it('preserves arg descriptions', () => {
			const schema = buildSchema(`
				type Query {
					"""A test query."""
					find(
						"""The unique identifier."""
						id: ID!
					): String
				}
			`)
			const args = schema.getQueryType()!.getFields().find.args

			const result = graphqlArgsToInputSchema(args)
			expect(result.properties?.id?.description).toBe('The unique identifier.')
		})
	})

	describe('integration with fixture schema', () => {
		it('converts productCreate mutation args to valid inputSchema', async () => {
			const parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			const op = parsed.operations.find(o => o.name === 'productCreate' && o.operationType === 'mutation')
			expect(op).toBeDefined()

			const inputSchema = graphqlArgsToInputSchema(op!.args)
			expect(inputSchema.type).toBe('object')
			expect(inputSchema.properties).toBeDefined()
			expect(Object.keys(inputSchema.properties!).length).toBeGreaterThan(0)
		})

		it('converts product query args to valid inputSchema', async () => {
			const parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			const op = parsed.operations.find(o => o.name === 'product' && o.operationType === 'query')
			expect(op).toBeDefined()

			const inputSchema = graphqlArgsToInputSchema(op!.args)
			expect(inputSchema.type).toBe('object')
			expect(inputSchema.properties?.id).toBeDefined()
			expect(inputSchema.required).toContain('id')
		})

		it('handles enum args from the fixture schema', async () => {
			const parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			const op = parsed.operations.find(o => o.name === 'products' && o.operationType === 'query')
			expect(op).toBeDefined()

			const inputSchema = graphqlArgsToInputSchema(op!.args)
			const sortKeyProp = inputSchema.properties?.sortKey
			expect(sortKeyProp).toBeDefined()
			expect(sortKeyProp?.type).toBe('string')
			expect(sortKeyProp?.enum).toBeDefined()
			expect(sortKeyProp!.enum!.length).toBeGreaterThan(0)
		})

		it('converts all operations without errors', async () => {
			const parsed = await loadSchema({schemaPath: FIXTURE_PATH, endpoint: 'http://localhost:4000/graphql'})
			for (const op of parsed.operations) {
				expect(() => graphqlArgsToInputSchema(op.args)).not.toThrow()
			}
		})
	})
})
