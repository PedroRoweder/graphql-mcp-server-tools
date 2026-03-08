import {
	type GraphQLArgument,
	type GraphQLEnumType,
	type GraphQLInputObjectType,
	type GraphQLNamedType,
	type GraphQLType,
	isEnumType,
	isInputObjectType,
	isListType,
	isNonNullType,
	isScalarType,
} from 'graphql'
import type {JsonSchema} from './types.js'

const STANDARD_SCALAR_MAP: Record<string, JsonSchema> = {
	String: {type: 'string'},
	Int: {type: 'integer'},
	Float: {type: 'number'},
	Boolean: {type: 'boolean'},
	ID: {type: 'string'},
}

/**
 * Unwrap NonNull/List wrappers and convert the inner named type.
 * Returns `{schema, isNonNull}` so callers can decide whether to add to `required`.
 */
function unwrapType(
	type: GraphQLType,
	visited: Set<string>,
	scalarMap: Record<string, JsonSchema>,
): {schema: JsonSchema; isNonNull: boolean} {
	if (isNonNullType(type)) {
		const inner = unwrapType(type.ofType, visited, scalarMap)
		return {schema: inner.schema, isNonNull: true}
	}

	if (isListType(type)) {
		const inner = unwrapType(type.ofType, visited, scalarMap)
		return {schema: {type: 'array', items: inner.schema}, isNonNull: false}
	}

	return {schema: convertNamedType(type, visited, scalarMap), isNonNull: false}
}

function convertNamedType(
	type: GraphQLNamedType,
	visited: Set<string>,
	scalarMap: Record<string, JsonSchema>,
): JsonSchema {
	if (isScalarType(type)) {
		const mapped = scalarMap[type.name]
		return mapped ? {...mapped} : {type: 'string', description: type.name}
	}

	if (isEnumType(type)) {
		return convertEnumType(type)
	}

	if (isInputObjectType(type)) {
		return convertInputObjectType(type, visited, scalarMap)
	}

	return {type: 'object'}
}

function convertEnumType(type: GraphQLEnumType): JsonSchema {
	return {type: 'string', enum: type.getValues().map(v => v.name)}
}

/**
 * Tracks in-progress type names via `visited` to break circular references
 * (e.g. MetafieldInput containing MetafieldInput). The entry is removed after
 * conversion so sibling references to the same type still resolve fully.
 */
function convertInputObjectType(
	type: GraphQLInputObjectType,
	visited: Set<string>,
	scalarMap: Record<string, JsonSchema>,
): JsonSchema {
	if (visited.has(type.name)) {
		return {type: 'object', description: `Recursive reference to ${type.name}`}
	}

	visited.add(type.name)

	const fields = type.getFields()
	const properties: Record<string, JsonSchema> = {}
	const required: string[] = []

	for (const field of Object.values(fields)) {
		const {schema, isNonNull} = unwrapType(field.type, visited, scalarMap)

		if (field.description) {
			schema.description = field.description
		}

		properties[field.name] = schema

		if (isNonNull) {
			required.push(field.name)
		}
	}

	visited.delete(type.name)

	const result: JsonSchema = {type: 'object', properties}
	if (required.length > 0) {
		result.required = required
	}
	return result
}

function buildScalarMap(customScalars?: Record<string, JsonSchema>): Record<string, JsonSchema> {
	if (!customScalars) return STANDARD_SCALAR_MAP
	return {...STANDARD_SCALAR_MAP, ...customScalars}
}

/**
 * Convert a single GraphQL type to its JSON Schema representation.
 * Handles NonNull, List, Scalar, Enum, and InputObject types.
 */
export function graphqlTypeToJsonSchema(type: GraphQLType, customScalars?: Record<string, JsonSchema>): JsonSchema {
	const {schema} = unwrapType(type, new Set<string>(), buildScalarMap(customScalars))
	return schema
}

/**
 * Convert a list of GraphQL arguments into a top-level JSON Schema object
 * suitable for an MCP tool's `inputSchema`.
 */
export function graphqlArgsToInputSchema(
	args: readonly GraphQLArgument[],
	customScalars?: Record<string, JsonSchema>,
): JsonSchema {
	if (args.length === 0) {
		return {type: 'object', properties: {}}
	}

	const scalarMap = buildScalarMap(customScalars)
	const properties: Record<string, JsonSchema> = {}
	const required: string[] = []

	for (const arg of args) {
		const {schema, isNonNull} = unwrapType(arg.type, new Set<string>(), scalarMap)

		if (arg.description) {
			schema.description = arg.description
		}

		properties[arg.name] = schema

		if (isNonNull) {
			required.push(arg.name)
		}
	}

	const result: JsonSchema = {type: 'object', properties}
	if (required.length > 0) {
		result.required = required
	}
	return result
}
