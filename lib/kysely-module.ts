import type { AnyModule, Module, OnShutdown } from "awilixify";
import type { Kysely } from "kysely";
import {
	createScopedDatabase,
	type ScopedDatabase,
	type TableName,
	type TableScope,
} from "./scoped-database.js";
import type { LiteralName } from "./types.js";

const DEFAULT_PROVIDER_NAMES = {
	rootProviderName: "rootDb",
	scopedProviderName: "scopedDb",
} as const;

// Default names may be omitted; non-default generic names require a matching runtime value.
// Otherwise an explicit name generic could claim a key while runtime uses the default.
type ProviderNameOption<
	Key extends keyof typeof DEFAULT_PROVIDER_NAMES,
	Name extends string,
> = {
	[Property in Key]?: Name & LiteralName<Name>;
} & ([Name] extends [(typeof DEFAULT_PROVIDER_NAMES)[Key]]
	? unknown
	: Record<Key, Name>);

type NamedProvider<Name extends string, Value> = {
	providers: Record<Name, Value>;
	exports: Record<Name, Value>;
	exportKeys: [Name];
};

type KyselyRootModuleDef<DB, RootName extends string> = NamedProvider<
	RootName,
	Kysely<DB>
> & {
	providers: { kyselyLifecycle: OnShutdown };
};

type KyselyScopeModuleDef<
	DB,
	Read extends TableName<DB>,
	Write extends Read,
	RootName extends string,
	ScopedName extends string,
> = NamedProvider<ScopedName, ScopedDatabase<DB, Read, Write>> & {
	imports: [Module<KyselyRootModuleDef<DB, RootName>>];
};

type KyselyScopeFactory<
	DB,
	RootName extends string,
	ScopedName extends string,
> = <const Read extends TableName<DB>, const Write extends NoInfer<Read>>(
	scope: TableScope<DB, Read, Write>,
) => Module<KyselyScopeModuleDef<DB, Read, Write, RootName, ScopedName>>;

type KyselyModuleFactory<
	DB,
	RootName extends string,
	ScopedName extends string,
> = Module<KyselyRootModuleDef<DB, RootName>> &
	KyselyScopeFactory<DB, RootName, ScopedName>;

let nextId = 0;

export function createKyselyModuleFactory<
	DB,
	const RootName extends
		string = typeof DEFAULT_PROVIDER_NAMES.rootProviderName,
	const ScopedName extends
		string = typeof DEFAULT_PROVIDER_NAMES.scopedProviderName,
>(
	options: {
		db: Kysely<DB>;
		/** Defaults to true. Disable when the application owns database shutdown. */
		destroyOnShutdown?: boolean;
	} & ProviderNameOption<"rootProviderName", RootName> &
		ProviderNameOption<"scopedProviderName", ScopedName>,
): KyselyModuleFactory<DB, RootName, ScopedName> {
	const {
		db,
		destroyOnShutdown = true,
		rootProviderName = DEFAULT_PROVIDER_NAMES.rootProviderName,
		scopedProviderName = DEFAULT_PROVIDER_NAMES.scopedProviderName,
	} = options;

	if (
		typeof rootProviderName !== "string" ||
		typeof scopedProviderName !== "string" ||
		!rootProviderName ||
		!scopedProviderName ||
		rootProviderName === scopedProviderName
	) {
		throw new Error(
			"Root and scoped provider names must be non-empty, distinct strings",
		);
	}

	if (rootProviderName === "kyselyLifecycle") {
		throw new Error('Root provider name "kyselyLifecycle" is reserved');
	}

	const root: AnyModule = {
		name: `KyselyRootModule_${++nextId}`,
		providers: {
			[rootProviderName]: db,
			kyselyLifecycle: {
				useFactory: () => ({
					onShutdown: () => (destroyOnShutdown ? db.destroy() : undefined),
				}),
				lifetime: "SINGLETON",
				eager: true,
			},
		},
		exports: [rootProviderName],
	};

	const createScope = (scope: TableScope<DB>): AnyModule => ({
		name: `KyselyScopeModule_${++nextId}`,
		imports: [factory],
		providers: { [scopedProviderName]: createScopedDatabase(db, scope) },
		exports: [scopedProviderName],
	});

	// Attach root module properties to the callable scope factory:
	// imports: [DatabaseModule] exposes the root provider with the original Kysely type;
	// imports: [DatabaseModule(scope)] exposes the scoped provider with scoped table types.
	const { name, ...definition } = root;
	const factory = Object.assign(createScope, definition);
	// A function's name is not writable, so Object.assign cannot copy it.
	// Keep it enumerable so module object spreads preserve the root name.
	Object.defineProperty(factory, "name", { value: name, enumerable: true });

	// Computed provider keys widen to string in object literals; restore their inferred names.
	return factory as unknown as KyselyModuleFactory<DB, RootName, ScopedName>;
}
