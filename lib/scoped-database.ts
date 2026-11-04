import type {
	Kysely,
	KyselyPlugin,
	SimpleTableReference,
	TableExpression,
} from "kysely";
import type { ScopedConnections } from "./scoped-connections.js";
import type { ScopedCtes } from "./scoped-ctes.js";
import type { ScopedTransactions } from "./scoped-transactions.js";

// Kysely table names are strings; exclude numeric and symbol keys from keyof DB.
export type TableName<DB> = keyof DB & string;

export type TableScope<
	DB,
	Read extends TableName<DB> = TableName<DB>,
	Write extends Read = Read,
> = {
	readTables: readonly Read[];
	writeTables: readonly Write[];
};

// Narrow named targets only. Intersecting schemas also intersects callback
// signatures, which prevents contextual inference of their expression builder.
type WriteTarget<DB, Write extends TableName<DB>> =
	| SimpleTableReference<Pick<DB, Write>>
	| Exclude<TableExpression<DB, never>, string>;

type WriteTargets<DB, Write extends TableName<DB>> =
	| WriteTarget<DB, Write>
	| ReadonlyArray<WriteTarget<DB, Write>>;

// Reuse native generic return types to retain alias and result inference.
declare function scopedMutations<DB, Write extends TableName<DB>>(
	native: Kysely<DB>,
): {
	insertInto<Table extends Write>(
		table: Table,
	): ReturnType<typeof native.insertInto<Table>>;
	replaceInto<Table extends Write>(
		table: Table,
	): ReturnType<typeof native.replaceInto<Table>>;

	mergeInto<Table extends SimpleTableReference<Pick<DB, Write>>>(
		table: Table,
	): ReturnType<typeof native.mergeInto<Table>>;

	updateTable<Target extends WriteTargets<DB, Write>>(
		target: Target,
	): ReturnType<typeof native.updateTable<Target>>;

	deleteFrom<Target extends WriteTargets<DB, Write>>(
		target: Target,
	): ReturnType<typeof native.deleteFrom<Target>>;
};

export type ScopedMutations<DB, Write extends TableName<DB>> = ReturnType<
	typeof scopedMutations<DB, Write>
>;

export type ScopedDatabase<
	DB,
	Read extends TableName<DB>,
	Write extends Read,
> = Omit<
	Kysely<Pick<DB, Read>>,
	| keyof ScopedMutations<DB, Write>
	| keyof ScopedTransactions<DB, Write>
	| keyof ScopedConnections<DB, Write>
	| keyof ScopedCtes<DB, Write>
	| "withSchema"
	| "withPlugin"
	| "withoutPlugins"
> &
	ScopedMutations<Pick<DB, Read>, Write> &
	ScopedTransactions<Pick<DB, Read>, Write> &
	ScopedConnections<Pick<DB, Read>, Write> &
	ScopedCtes<Pick<DB, Read>, Write> & {
		withSchema(schema: string): ScopedDatabase<DB, Read, Write>;
		withPlugin(plugin: KyselyPlugin): ScopedDatabase<DB, Read, Write>;
		withoutPlugins(): ScopedDatabase<DB, Read, Write>;
	};

export function createScopedDatabase<
	DB,
	Read extends TableName<DB>,
	Write extends NoInfer<Read>,
>(
	db: Kysely<DB>,
	scope: TableScope<DB, Read, Write>,
): ScopedDatabase<DB, Read, Write> {
	for (const table of scope.writeTables) {
		if (!scope.readTables.includes(table)) {
			throw new Error(`Writable table "${table}" must also be readable`);
		}
	}

	// Only the TypeScript view changes; the original instance is untouched.
	return db as unknown as ScopedDatabase<DB, Read, Write>;
}
