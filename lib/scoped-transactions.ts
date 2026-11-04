import type {
	Command,
	ControlledTransaction,
	ControlledTransactionBuilder,
	KyselyPlugin,
	Transaction,
	TransactionBuilder,
} from "kysely";
import type { ScopedCtes } from "./scoped-ctes.js";
import type { ScopedMutations, TableName } from "./scoped-database.js";

type ScopedTransaction<DB, Write extends TableName<DB>> = Omit<
	Transaction<DB>,
	| keyof ScopedMutations<DB, Write>
	| keyof ScopedCtes<DB, Write>
	| "withSchema"
	| "withPlugin"
	| "withoutPlugins"
> &
	ScopedMutations<DB, Write> &
	ScopedCtes<DB, Write> & {
		withSchema(schema: string): ScopedTransaction<DB, Write>;
		withPlugin(plugin: KyselyPlugin): ScopedTransaction<DB, Write>;
		withoutPlugins(): ScopedTransaction<DB, Write>;
	};

// Keep Kysely's savepoint state inference while narrowing the returned transaction.
type ScopedTransactionCommand<C, DB, Write extends TableName<DB>> =
	C extends Command<ControlledTransaction<DB, infer Savepoints>>
		? Omit<C, "execute"> & {
				execute(): Promise<ScopedControlledTransaction<DB, Write, Savepoints>>;
			}
		: never;

declare function scopedSavepoints<
	DB,
	Write extends TableName<DB>,
	S extends string[],
>(
	native: ControlledTransaction<DB, S>,
): {
	savepoint<SN extends string>(
		name: SN extends S ? never : SN,
	): ScopedTransactionCommand<
		ReturnType<typeof native.savepoint<SN>>,
		DB,
		Write
	>;
	rollbackToSavepoint<SN extends S[number]>(
		name: SN,
	): ScopedTransactionCommand<
		ReturnType<typeof native.rollbackToSavepoint<SN>>,
		DB,
		Write
	>;
	releaseSavepoint<SN extends S[number]>(
		name: SN,
	): ScopedTransactionCommand<
		ReturnType<typeof native.releaseSavepoint<SN>>,
		DB,
		Write
	>;
};

type ScopedControlledTransaction<
	DB,
	Write extends TableName<DB>,
	S extends string[] = [],
> = Omit<
	ControlledTransaction<DB, S>,
	| keyof ScopedMutations<DB, Write>
	| keyof ScopedCtes<DB, Write>
	| "savepoint"
	| "rollbackToSavepoint"
	| "releaseSavepoint"
	| "withSchema"
	| "withPlugin"
	| "withoutPlugins"
> &
	ScopedMutations<DB, Write> &
	ScopedCtes<DB, Write> &
	ReturnType<typeof scopedSavepoints<DB, Write, S>> & {
		withSchema(schema: string): ScopedControlledTransaction<DB, Write, S>;
		withPlugin(plugin: KyselyPlugin): ScopedControlledTransaction<DB, Write, S>;
		withoutPlugins(): ScopedControlledTransaction<DB, Write, S>;
	};

type ScopedTransactionBuilder<DB, Write extends TableName<DB>> = Omit<
	TransactionBuilder<DB>,
	"execute" | "setAccessMode" | "setIsolationLevel"
> & {
	setAccessMode(
		...args: Parameters<TransactionBuilder<DB>["setAccessMode"]>
	): ScopedTransactionBuilder<DB, Write>;
	setIsolationLevel(
		...args: Parameters<TransactionBuilder<DB>["setIsolationLevel"]>
	): ScopedTransactionBuilder<DB, Write>;
	execute<T>(
		callback: (trx: ScopedTransaction<DB, Write>) => Promise<T>,
	): Promise<T>;
};

type ScopedControlledTransactionBuilder<DB, Write extends TableName<DB>> = Omit<
	ControlledTransactionBuilder<DB>,
	"execute" | "setAccessMode" | "setIsolationLevel"
> & {
	setAccessMode(
		...args: Parameters<ControlledTransactionBuilder<DB>["setAccessMode"]>
	): ScopedControlledTransactionBuilder<DB, Write>;
	setIsolationLevel(
		...args: Parameters<ControlledTransactionBuilder<DB>["setIsolationLevel"]>
	): ScopedControlledTransactionBuilder<DB, Write>;
	execute(): Promise<ScopedControlledTransaction<DB, Write>>;
};

export type ScopedTransactions<DB, Write extends TableName<DB>> = {
	transaction(): ScopedTransactionBuilder<DB, Write>;
	startTransaction(): ScopedControlledTransactionBuilder<DB, Write>;
};
