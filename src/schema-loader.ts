import {readFileSync} from 'node:fs'
import {
	buildClientSchema,
	buildSchema,
	getIntrospectionQuery,
	type GraphQLField,
	type GraphQLSchema,
} from 'graphql'
import type {GraphQLOperation, McpGraphQLConfig, ParsedSchema} from './types.js'

function extractFields(
	fields: Record<string, GraphQLField<unknown, unknown>>,
	operationType: 'query' | 'mutation',
): GraphQLOperation[] {
	return Object.values(fields).map(field => ({
		name: field.name,
		description: field.description ?? '',
		operationType,
		args: field.args,
		returnType: field.type,
	}))
}

function extractOperations(schema: GraphQLSchema): GraphQLOperation[] {
	const queryType = schema.getQueryType()
	const mutationType = schema.getMutationType()

	const operations: GraphQLOperation[] = []

	if (queryType) {
		operations.push(...extractFields(queryType.getFields(), 'query'))
	}

	if (mutationType) {
		operations.push(...extractFields(mutationType.getFields(), 'mutation'))
	}

	return operations
}

async function loadSchemaFromIntrospection(
	endpoint: string,
	headers?: Record<string, string>,
): Promise<GraphQLSchema> {
	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {'Content-Type': 'application/json', ...headers},
		body: JSON.stringify({query: getIntrospectionQuery()}),
	})

	if (!response.ok) {
		throw new Error(`Introspection request failed with status ${response.status}: ${response.statusText}`)
	}

	const body = (await response.json()) as {data?: unknown; errors?: Array<{message: string}>}

	if (body.errors) {
		throw new Error(`Introspection query returned errors: ${JSON.stringify(body.errors)}`)
	}

	if (!body.data) {
		throw new Error('Introspection query returned no data')
	}

	return buildClientSchema(body.data as Parameters<typeof buildClientSchema>[0])
}

/** Load and parse a GraphQL schema from the configured source. */
export async function loadSchema(config: McpGraphQLConfig): Promise<ParsedSchema> {
	let schema: GraphQLSchema

	if (config.schema) {
		schema = config.schema
	} else if (config.schemaString) {
		schema = buildSchema(config.schemaString)
	} else if (config.schemaPath) {
		const sdl = readFileSync(config.schemaPath, 'utf-8')
		schema = buildSchema(sdl)
	} else if (config.introspectionEndpoint) {
		const staticHeaders = typeof config.headers === 'function' ? await config.headers() : config.headers
		schema = await loadSchemaFromIntrospection(config.introspectionEndpoint, staticHeaders)
	} else {
		throw new Error(
			'No schema source provided. Set one of: schemaPath, schemaString, schema, or introspectionEndpoint',
		)
	}

	return {operations: extractOperations(schema), schema}
}
