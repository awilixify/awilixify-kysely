import type {
	AccessMode,
	DeleteQueryBuilder,
	DeleteResult,
	InsertQueryBuilder,
	InsertResult,
	IsolationLevel,
	Kysely,
	TransactionBuilder,
	UpdateQueryBuilder,
	UpdateResult,
} from "kysely";

export type TableName<DB> = Extract<keyof DB, string>;

export type TableScope<
	DB,
	Read extends TableName<DB> = TableName<DB>,
	Write extends Read = Read,
> = {
	readTables: readonly Read[];
	writeTables: readonly Write[];
};

export type ScopedTransaction<
	DB,
	Read extends TableName<DB>,
	Write extends Read,
> = Pick<Kysely<Pick<DB, Read>>, "selectFrom"> & {
	insertInto<Table extends Write>(
		table: Table,
	): InsertQueryBuilder<Pick<DB, Read>, Table, InsertResult>;
	updateTable<Table extends Write>(
		table: Table,
	): UpdateQueryBuilder<Pick<DB, Read>, Table, Table, UpdateResult>;
	deleteFrom<Table extends Write>(
		table: Table,
	): DeleteQueryBuilder<Pick<DB, Read>, Table, DeleteResult>;
};

export interface ScopedTransactionBuilder<
	DB,
	Read extends TableName<DB>,
	Write extends Read,
> {
	setAccessMode(
		accessMode: AccessMode,
	): ScopedTransactionBuilder<DB, Read, Write>;
	setIsolationLevel(
		isolationLevel: IsolationLevel,
	): ScopedTransactionBuilder<DB, Read, Write>;
	execute<T>(
		callback: (trx: ScopedTransaction<DB, Read, Write>) => Promise<T>,
	): Promise<T>;
}

export type ScopedDatabase<
	DB,
	Read extends TableName<DB>,
	Write extends Read,
> = ScopedTransaction<DB, Read, Write> & {
	transaction(): ScopedTransactionBuilder<DB, Read, Write>;
};

export function createScopedDatabase<
	DB,
	Read extends TableName<DB>,
	Write extends NoInfer<Read>,
>(
	db: Kysely<DB>,
	scope: TableScope<DB, Read, Write>,
): ScopedDatabase<DB, Read, Write> {
	const readable = new Set<string>(scope.readTables);
	const writable = new Set<string>(scope.writeTables);

	for (const table of writable) {
		if (!readable.has(table)) {
			throw new Error(`Writable table "${table}" must also be readable`);
		}
	}

	function assertWritable(table: string) {
		if (!writable.has(table)) {
			throw new Error(`Table "${table}" is not writable in this module`);
		}
	}

	function queries(
		database: Kysely<Pick<DB, Read>>,
	): ScopedTransaction<DB, Read, Write> {
		return {
			selectFrom: database.selectFrom.bind(database),
			insertInto<Table extends Write>(table: Table) {
				assertWritable(table);
				return database.insertInto(table);
			},
			updateTable<Table extends Write>(table: Table) {
				assertWritable(table);
				// Literal targets exclude Kysely's alias and multi-table return branches.
				return database.updateTable(table) as unknown as UpdateQueryBuilder<
					Pick<DB, Read>,
					Table,
					Table,
					UpdateResult
				>;
			},
			deleteFrom<Table extends Write>(table: Table) {
				assertWritable(table);
				return database.deleteFrom(table) as unknown as DeleteQueryBuilder<
					Pick<DB, Read>,
					Table,
					DeleteResult
				>;
			},
		};
	}

	function transaction(
		builder: TransactionBuilder<Pick<DB, Read>>,
	): ScopedTransactionBuilder<DB, Read, Write> {
		return {
			setAccessMode: (mode) => transaction(builder.setAccessMode(mode)),
			setIsolationLevel: (level) =>
				transaction(builder.setIsolationLevel(level)),
			execute: (callback) => builder.execute((trx) => callback(queries(trx))),
		};
	}

	// Narrow the schema without changing the shared driver or connection pool.
	const scopedDb = db as unknown as Kysely<Pick<DB, Read>>;
	return {
		...queries(scopedDb),
		transaction: () => transaction(scopedDb.transaction()),
	};
}
