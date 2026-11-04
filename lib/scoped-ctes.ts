import type {
	CommonTableExpressionOutput,
	KyselyPlugin,
	QueryCreator,
	QueryCreatorWithCommonTableExpression,
	RecursiveCommonTableExpression,
} from "kysely";
import type { ScopedMutations, TableName } from "./scoped-database.js";

type CteName<N extends string> = N extends `${infer Table}(${string})`
	? Table
	: N;
type CteOutput<E> = E extends (...args: any[]) => infer Output ? Output : E;

type WithCte<DB, Write extends TableName<DB>, N extends string, E> =
	QueryCreatorWithCommonTableExpression<
		DB,
		N,
		CteOutput<E>
	> extends QueryCreator<infer NextDB>
		? ScopedQueryCreator<NextDB, Exclude<Write, CteName<N>> & TableName<NextDB>>
		: never;

type RecursiveDB<DB, N extends string> =
	Parameters<RecursiveCommonTableExpression<DB, N>>[0] extends QueryCreator<
		infer NextDB
	>
		? NextDB
		: never;

type ScopedExpression<DB, Write extends TableName<DB>, N extends string> =
	| CommonTableExpressionOutput<DB, N>
	| ((
			creator: ScopedQueryCreator<DB, Write>,
	  ) => CommonTableExpressionOutput<DB, N>);

// Reuse native CTE name/builder parameters and output inference.
declare function scopedCtes<DB, Write extends TableName<DB>>(
	native: QueryCreator<DB>,
): {
	with<N extends string, E extends ScopedExpression<DB, Write, N>>(
		nameOrBuilder: Parameters<
			typeof native.with<N, CommonTableExpressionOutput<DB, N>>
		>[0],
		expression: E,
	): WithCte<DB, Write, N, E>;
	withRecursive<
		N extends string,
		E extends (
			creator: ScopedQueryCreator<
				RecursiveDB<DB, N>,
				Exclude<Write, CteName<N>> & TableName<RecursiveDB<DB, N>>
			>,
		) => CommonTableExpressionOutput<DB, N>,
	>(
		nameOrBuilder: Parameters<
			typeof native.withRecursive<N, RecursiveCommonTableExpression<DB, N>>
		>[0],
		expression: E,
	): WithCte<DB, Write, N, E>;
};

export type ScopedCtes<DB, Write extends TableName<DB>> = ReturnType<
	typeof scopedCtes<DB, Write>
>;

type ScopedQueryCreator<DB, Write extends TableName<DB>> = Omit<
	QueryCreator<DB>,
	| keyof ScopedMutations<DB, Write>
	| keyof ScopedCtes<DB, Write>
	| "withSchema"
	| "withPlugin"
	| "withoutPlugins"
> &
	ScopedMutations<DB, Write> &
	ScopedCtes<DB, Write> & {
		withSchema(schema: string): ScopedQueryCreator<DB, Write>;
		withPlugin(plugin: KyselyPlugin): ScopedQueryCreator<DB, Write>;
		withoutPlugins(): ScopedQueryCreator<DB, Write>;
	};
