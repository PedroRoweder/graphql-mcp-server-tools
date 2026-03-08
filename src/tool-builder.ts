import {
	type GraphQLArgument,
	type GraphQLField,
	type GraphQLInterfaceType,
	type GraphQLNamedType,
	type GraphQLObjectType,
	getNamedType,
	isInterfaceType,
	isLeafType,
	isNonNullType,
	isObjectType,
	isUnionType,
} from 'graphql'
import {graphqlArgsToInputSchema} from './type-converter.js'
import type {GraphQLOperation, McpToolDefinition, ParsedSchema, ResolvedConfig} from './types.js'

function buildToolName(operationName: string, prefix: string): string {
	return `${prefix}${operationName}`
}

function hasRequiredArgs(field: GraphQLField<unknown, unknown>): boolean {
	return field.args.some(arg => isNonNullType(arg.type))
}

function isConnectionType(type: GraphQLObjectType): boolean {
	return type.name.endsWith('Connection') && 'nodes' in type.getFields()
}

function selectInterfaceFields(type: GraphQLInterfaceType): string[] {
	const selections: string[] = ['__typename']
	for (const field of Object.values(type.getFields())) {
		if (hasRequiredArgs(field)) continue
		const fieldType = getNamedType(field.type)
		if (fieldType && isLeafType(fieldType)) {
			selections.push(field.name)
		}
	}
	return selections
}

/**
 * Build selection for connection types using the `nodes` shorthand
 * plus `pageInfo` with all four standard pagination fields.
 */
function selectConnectionFields(
	type: GraphQLObjectType,
	depth: number,
	visited: Set<string>,
	maxDepth: number,
): string[] {
	const fields = type.getFields()
	const selections: string[] = []

	const nodesField = fields.nodes
	if (nodesField) {
		const nodeType = getNamedType(nodesField.type)
		if (nodeType && !isLeafType(nodeType)) {
			const nodeSelections = selectFields(nodeType, depth + 1, visited, maxDepth)
			if (nodeSelections.length > 0) {
				selections.push(`nodes { ${nodeSelections.join(' ')} }`)
			}
		}
	}

	if (fields.pageInfo) {
		selections.push('pageInfo { hasNextPage hasPreviousPage startCursor endCursor }')
	}

	return selections
}

/**
 * Recurse into object type fields up to maxDepth, skipping fields
 * with required arguments and nested connection types.
 */
function selectObjectFields(
	type: GraphQLObjectType,
	depth: number,
	visited: Set<string>,
	maxDepth: number,
): string[] {
	if (isConnectionType(type)) {
		return selectConnectionFields(type, depth, visited, maxDepth)
	}

	if (visited.has(type.name)) return ['__typename']
	visited.add(type.name)

	const selections: string[] = []

	for (const field of Object.values(type.getFields())) {
		if (hasRequiredArgs(field)) continue

		const fieldType = getNamedType(field.type)
		if (!fieldType) continue

		if (isLeafType(fieldType)) {
			selections.push(field.name)
			continue
		}

		if (depth >= maxDepth) continue
		if (isObjectType(fieldType) && isConnectionType(fieldType)) continue

		const subSelections = selectFields(fieldType, depth + 1, visited, maxDepth)
		if (subSelections.length > 0) {
			selections.push(`${field.name} { ${subSelections.join(' ')} }`)
		}
	}

	visited.delete(type.name)
	return selections
}

function selectFields(type: GraphQLNamedType, depth: number, visited: Set<string>, maxDepth: number): string[] {
	if (isLeafType(type)) return []
	if (isUnionType(type)) return ['__typename']
	if (isInterfaceType(type)) return selectInterfaceFields(type)
	if (isObjectType(type)) return selectObjectFields(type, depth, visited, maxDepth)
	return ['__typename']
}

function buildVariableDeclarations(args: readonly GraphQLArgument[]): string {
	if (args.length === 0) return ''
	return `(${args.map(arg => `$${arg.name}: ${arg.type.toString()}`).join(', ')})`
}

function buildArgumentPassthrough(args: readonly GraphQLArgument[]): string {
	if (args.length === 0) return ''
	return `(${args.map(arg => `${arg.name}: $${arg.name}`).join(', ')})`
}

function buildDocument(operation: GraphQLOperation, maxDepth: number): string {
	const varDecls = buildVariableDeclarations(operation.args)
	const argPass = buildArgumentPassthrough(operation.args)
	const returnType = getNamedType(operation.returnType)

	let selectionBody = ''
	if (returnType && !isLeafType(returnType)) {
		const fields = selectFields(returnType, 0, new Set<string>(), maxDepth)
		selectionBody = fields.length > 0 ? ` { ${fields.join(' ')} }` : ' { __typename }'
	}

	return `${operation.operationType} ${operation.name}${varDecls} { ${operation.name}${argPass}${selectionBody} }`
}

function buildTool(operation: GraphQLOperation, config: ResolvedConfig): McpToolDefinition {
	const rawInputSchema = graphqlArgsToInputSchema(operation.args, config.customScalars)
	const inputSchema: McpToolDefinition['inputSchema'] = {type: 'object', properties: rawInputSchema.properties}
	if (rawInputSchema.required && rawInputSchema.required.length > 0) {
		inputSchema.required = rawInputSchema.required
	}
	return {
		name: buildToolName(operation.name, config.toolPrefix),
		description: operation.description,
		inputSchema,
		document: buildDocument(operation, config.maxSelectionDepth),
	}
}

/** Build MCP tool definitions for all GraphQL operations. */
export function buildTools(parsedSchema: ParsedSchema, config: ResolvedConfig): McpToolDefinition[] {
	const operations = config.operationFilter
		? parsedSchema.operations.filter(config.operationFilter)
		: parsedSchema.operations
	return operations.map(op => buildTool(op, config))
}
