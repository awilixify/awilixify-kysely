import { createModule, type Module, type ModuleDef } from "awilixify";
import type { Kysely } from "kysely";
import {
	createScopedDatabase,
	type ScopedDatabase,
	type TableName,
	type TableScope,
} from "./scoped-database.js";

export type KyselyRootModuleDef<DB> = ModuleDef<{
	providers: { db: Kysely<DB> };
	exportKeys: ["db"];
}>;

export type KyselyScopeModuleDef<
	DB,
	Read extends TableName<DB>,
	Write extends Read,
> = ModuleDef<{
	providers: { db: ScopedDatabase<DB, Read, Write> };
	exportKeys: ["db"];
}>;

type KyselyScopeFactory<DB> = <
	const Read extends TableName<DB>,
	const Write extends NoInfer<Read>,
>(
	scope: TableScope<DB, Read, Write>,
) => Module<KyselyScopeModuleDef<DB, Read, Write>>;

export type KyselyModuleFactory<DB> = Module<KyselyRootModuleDef<DB>> &
	KyselyScopeFactory<DB>;

let nextId = 0;

export function createKyselyModuleFactory<DB>({
	db,
}: {
	db: Kysely<DB>;
}): KyselyModuleFactory<DB> {
	const root = createModule<KyselyRootModuleDef<DB>>({
		name: `KyselyRootModule_${++nextId}`,
		providers: { db },
		exports: ["db"],
	});

	const createScope: KyselyScopeFactory<DB> = (scope) =>
		createModule({
			name: `KyselyScopeModule_${++nextId}`,
			providers: { db: createScopedDatabase(db, scope) },
			exports: ["db"],
		});

	// Attach root module properties to the callable scope factory:
	// imports: [DatabaseModule] exposes the original db;
	// imports: [DatabaseModule(scope)] exposes a restricted db.
	const { name, ...definition } = root;
	const factory = Object.assign(createScope, definition);
	// A function's name is not writable, so Object.assign cannot copy it.
	// Keep it enumerable so module object spreads preserve the root name.
	Object.defineProperty(factory, "name", { value: name, enumerable: true });

	return factory;
}
