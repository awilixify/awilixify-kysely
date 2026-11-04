import type { ModuleDef } from "awilixify";
import {
	CompiledQuery,
	type ExpressionBuilder,
	type Kysely,
	type KyselyPlugin,
} from "kysely";
import { describe, expect, test } from "tstyche";
import { createKyselyModuleFactory, type ScopedDatabase } from "../index.js";
import type { Database } from "./fixture.js";

declare const db: Kysely<Database>;
declare const plugin: KyselyPlugin;

const OrdersModule = createKyselyModuleFactory({ db });
const orders = OrdersModule({
	readTables: ["posts", "users"],
	writeTables: ["posts"],
});
type Def = ModuleDef<{ imports: [typeof orders] }>;
declare const scopedDb: Def["deps"]["scopedDb"];

type AnalyticsDatabase = { events: { id: number; kind: string } };
declare const analyticsDb: Kysely<AnalyticsDatabase>;
declare const wideName: string;
declare const unionName: "orders" | "analytics";
declare const patternName: `database_${number}`;

describe("scoped permissions", () => {
	test("scoped databases preserve native inference for readable aliases", () => {
		expect(
			scopedDb.selectFrom("users as u").select("u.id").execute(),
		).type.toBe<Promise<{ id: number }[]>>();
	});

	test("write operations accept posts and writable aliases", () => {
		scopedDb
			.insertInto("posts")
			.values({ id: 1, authorId: 2, published: false });
		scopedDb
			.replaceInto("posts")
			.values({ id: 1, authorId: 2, published: false });
		scopedDb.updateTable("posts").set({ published: true });
		scopedDb.deleteFrom("posts").where("id", "=", 1);
		scopedDb
			.updateTable("posts as p")
			.set({ published: true })
			.where("p.id", "=", 1);
		scopedDb.deleteFrom("posts as p").where("p.id", "=", 1);
		scopedDb
			.mergeInto("posts as p")
			.using("users as u", "u.id", "p.authorId")
			.whenMatched()
			.thenUpdateSet({ published: true });
	});

	test("readable-only users cannot be write targets", () => {
		expect(scopedDb.insertInto).type.not.toBeCallableWith("users");
		expect(scopedDb.replaceInto).type.not.toBeCallableWith("users");
		expect(scopedDb.updateTable).type.not.toBeCallableWith("users");
		expect(scopedDb.deleteFrom).type.not.toBeCallableWith("users");
		expect(scopedDb.mergeInto).type.not.toBeCallableWith("users");
		expect(scopedDb.updateTable).type.not.toBeCallableWith("users as u");
		expect(scopedDb.mergeInto).type.not.toBeCallableWith("users as u");
		expect(scopedDb.updateTable).type.not.toBeCallableWith(["posts", "users"]);
		expect(scopedDb.deleteFrom).type.not.toBeCallableWith([
			"posts",
			"users as u",
		]);
		expect(scopedDb.deleteFrom).type.not.toBeCallableWith(["users as u"]);
	});

	test("write operations can read users through eb subqueries or merge sources", () => {
		scopedDb
			.updateTable("posts")
			.set({ published: true })
			.where((eb) =>
				eb.exists(
					eb
						.selectFrom("users")
						.select("id")
						.whereRef("users.id", "=", "posts.authorId"),
				),
			);

		scopedDb
			.deleteFrom("posts")
			.where((eb) =>
				eb.exists(
					eb
						.selectFrom("users")
						.select("id")
						.whereRef("users.id", "=", "posts.authorId"),
				),
			);

		scopedDb.insertInto("posts").values((eb) => ({
			id: 1,
			authorId: eb.selectFrom("users").select("id").where("active", "=", true),
			published: false,
		}));

		scopedDb.replaceInto("posts").values((eb) => ({
			id: 1,
			authorId: eb.selectFrom("users").select("id").where("active", "=", true),
			published: false,
		}));

		scopedDb
			.mergeInto("posts")
			.using("users", "users.id", "posts.authorId")
			.whenMatchedAnd("users.active", "=", true)
			.thenUpdateSet({ published: true });
	});

	test("scoped databases retain their permissions and all native members", () => {
		expect(scopedDb).type.toBe<
			ScopedDatabase<Database, "posts" | "users", "posts">
		>();
		expect<
			keyof Kysely<Pick<Database, "posts" | "users">>
		>().type.toBeAssignableTo<keyof typeof scopedDb>();
	});

	test("mutation target lists accept writable aliases", () => {
		scopedDb
			.updateTable(["posts as p"])
			.set({ published: true })
			.where("p.id", "=", 1);
		scopedDb.deleteFrom(["posts as p"]).where("p.id", "=", 1);
	});

	test("reads reject tables outside readTables", () => {
		expect(scopedDb.selectFrom).type.not.toBeCallableWith("secrets");
		expect(scopedDb.mergeInto("posts").using).type.not.toBeCallableWith(
			"secrets",
			"secrets.id",
			"posts.id",
		);

		scopedDb.updateTable("posts").where((eb) => {
			expect(eb.selectFrom).type.not.toBeCallableWith("secrets");

			return eb.exists(eb.selectFrom("users").select("id"));
		});
	});

	test("updates preserve column value types", () => {
		expect(scopedDb.updateTable("posts").set).type.not.toBeCallableWith({
			published: "yes",
		});
	});

	test("direct expression targets retain native inference as escape hatches", () => {
		const target = scopedDb.selectFrom("users").select("id").as("target");
		scopedDb.updateTable(target).set({ id: 1 });
		scopedDb.deleteFrom(target).where("target.id", "=", 1);
	});

	test("callback mutation targets infer eb from the readable schema", () => {
		scopedDb
			.updateTable((eb) => {
				expect(eb).type.toBe<
					ExpressionBuilder<Pick<Database, "posts" | "users">, never>
				>();
				expect(eb.selectFrom).type.not.toBeCallableWith("secrets");
				return eb.selectFrom("users").select("id").as("target");
			})
			.set({ id: 1 })
			.where("target.id", "=", 1);
		scopedDb
			.deleteFrom((eb) => {
				expect(eb).type.toBe<
					ExpressionBuilder<Pick<Database, "posts" | "users">, never>
				>();
				expect(eb.selectFrom).type.not.toBeCallableWith("secrets");
				return eb.selectFrom("users").select("id").as("target");
			})
			.where("target.id", "=", 1);
	});

	test("mutation target lists preserve callback inference", () => {
		scopedDb
			.updateTable([
				"posts",
				(eb) => {
					expect(eb).type.toBe<
						ExpressionBuilder<Pick<Database, "posts" | "users">, never>
					>();
					return eb.selectFrom("users").select("id").as("target");
				},
			])
			.set({ published: true })
			.where("target.id", "=", 1);
		scopedDb
			.deleteFrom([
				(eb) => {
					expect(eb).type.toBe<
						ExpressionBuilder<Pick<Database, "posts" | "users">, never>
					>();
					return eb.selectFrom("users").select("id").as("target");
				},
			])
			.where("target.id", "=", 1);
	});

	test("schema and plugin transformations preserve scoped permissions", () => {
		expect(scopedDb.withSchema("public")).type.toBe<typeof scopedDb>();
		expect(scopedDb.withPlugin(plugin)).type.toBe<typeof scopedDb>();
		expect(scopedDb.withoutPlugins()).type.toBe<typeof scopedDb>();
		const transformed = scopedDb
			.withSchema("public")
			.withPlugin(plugin)
			.withoutPlugins();
		transformed.updateTable("posts").set({ published: true });
		expect(transformed.updateTable).type.not.toBeCallableWith("users");
		expect(transformed.selectFrom).type.not.toBeCallableWith("secrets");
	});

	test("other native APIs remain available", () => {
		scopedDb.schema.createTable("other");
		scopedDb.getExecutor();
		scopedDb.executeQuery(CompiledQuery.raw("delete from users"));
		scopedDb.$extendTables<{ extra: { id: number } }>().selectFrom("extra");
		scopedDb.destroy();
	});

	test("empty writeTables allows reads but rejects direct mutations", () => {
		const readOnly = OrdersModule({ readTables: ["users"], writeTables: [] });
		type ReadOnlyDef = ModuleDef<{ imports: [typeof readOnly] }>;
		const readOnlyDb = {} as ReadOnlyDef["deps"]["scopedDb"];

		readOnlyDb.selectFrom("users");
		expect(readOnlyDb.updateTable).type.not.toBeCallableWith("users");
		expect(readOnlyDb.withSchema("public")).type.toBe<typeof readOnlyDb>();
		expect(readOnlyDb.withPlugin(plugin)).type.toBe<typeof readOnlyDb>();
		expect(readOnlyDb.withoutPlugins()).type.toBe<typeof readOnlyDb>();
		readOnlyDb.connection().execute(async (connectionDb) => {
			connectionDb.selectFrom("users");
			expect(connectionDb.updateTable).type.not.toBeCallableWith("users");
		});
		readOnlyDb.transaction().execute(async (trx) => {
			trx.selectFrom("users");
			expect(trx.updateTable).type.not.toBeCallableWith("users");
		});
		readOnlyDb
			.startTransaction()
			.execute()
			.then((trx) => {
				trx.selectFrom("users");
				expect(trx.updateTable).type.not.toBeCallableWith("users");
			});
	});

	test("writeTables must be a subset of readTables", () => {
		expect(OrdersModule).type.not.toBeCallableWith({
			readTables: ["users"],
			writeTables: ["posts"],
		});
	});

	test("readTables rejects unknown database tables", () => {
		expect(OrdersModule).type.not.toBeCallableWith({
			readTables: ["unknown"],
			writeTables: [],
		});
	});
});

describe("CTEs", () => {
	test("CTE callbacks and chains preserve permissions and row inference", () => {
		const query = scopedDb
			.with("active", (qb) => {
				expect(qb.updateTable).type.not.toBeCallableWith("users");
				expect(qb.selectFrom).type.not.toBeCallableWith("secrets");
				return qb.selectFrom("users").select("id");
			})
			.with("removed", (qb) => qb.deleteFrom("posts").returning("id"));
		expect(query.selectFrom("active").selectAll().execute()).type.toBe<
			Promise<{ id: number }[]>
		>();
		expect(query.selectFrom("removed").selectAll().execute()).type.toBe<
			Promise<{ id: number }[]>
		>();
		expect(query.updateTable).type.not.toBeCallableWith("users");
		expect(query.insertInto).type.not.toBeCallableWith("active");
		expect(query.deleteFrom).type.not.toBeCallableWith("removed");
		expect(query).type.not.toHaveProperty("transaction");
		expect(
			query.withSchema("public").withPlugin(plugin).withoutPlugins(),
		).type.toBe<typeof query>();
	});

	test("prebuilt expressions and CTE name builders preserve inference", () => {
		const expression = scopedDb.selectFrom("users").select("id");
		const query = scopedDb.with(
			(cte) => cte("ids(id)").materialized(),
			expression,
		);
		expect(query.selectFrom("ids").selectAll().execute()).type.toBe<
			Promise<{ id: number }[]>
		>();
	});

	test("recursive CTEs can read themselves without gaining write permissions", () => {
		const query = scopedDb.withRecursive("ancestors(id)", (qb) => {
			expect(qb.updateTable).type.not.toBeCallableWith("ancestors");
			return qb
				.selectFrom("users")
				.select("id")
				.unionAll(qb.selectFrom("ancestors").select("id"));
		});
		expect(query.selectFrom("ancestors").selectAll().execute()).type.toBe<
			Promise<{ id: number }[]>
		>();
		expect(query.updateTable).type.not.toBeCallableWith("ancestors");
	});

	test("CTEs shadowing writable table names become read-only", () => {
		const query = scopedDb.with("posts", (qb) =>
			qb.selectFrom("users").select("id"),
		);
		expect(query.updateTable).type.not.toBeCallableWith("posts");
		query.selectFrom("posts").select("id");
		const recursive = scopedDb.withRecursive("posts(id)", (qb) => {
			expect(qb.updateTable).type.not.toBeCallableWith("posts");
			return qb.selectFrom("users").select("id");
		});
		expect(recursive.updateTable).type.not.toBeCallableWith("posts");
	});

	test("read-only scopes remain read-only through CTEs", () => {
		const readOnly = OrdersModule({ readTables: ["users"], writeTables: [] });
		type ReadOnlyDef = ModuleDef<{ imports: [typeof readOnly] }>;
		const readOnlyDb = {} as ReadOnlyDef["deps"]["scopedDb"];
		const query = readOnlyDb.with("ids", (qb) => {
			expect(qb.updateTable).type.not.toBeCallableWith("users");
			return qb.selectFrom("users").select("id");
		});
		expect(query.updateTable).type.not.toBeCallableWith("users");
		expect(query.updateTable).type.not.toBeCallableWith("ids");
	});

	test("CTEs retain permissions inside connections and transactions", async () => {
		await scopedDb.connection().execute(async (db) => {
			const query = db.with("active", (qb) =>
				qb.selectFrom("users").select("id"),
			);
			expect(query.updateTable).type.not.toBeCallableWith("users");
		});
		await scopedDb.transaction().execute(async (trx) => {
			const query = trx.with("active", (qb) => {
				expect(qb.deleteFrom).type.not.toBeCallableWith("users");
				return qb.selectFrom("users").select("id");
			});
			expect(query.updateTable).type.not.toBeCallableWith("users");
		});
		const trx = await scopedDb.startTransaction().execute();
		const query = trx.with("active", (qb) =>
			qb.selectFrom("users").select("id"),
		);
		expect(query.updateTable).type.not.toBeCallableWith("users");
		expect(query).type.not.toHaveProperty("commit");
	});
});

describe("transactions", () => {
	test("schema and plugin transformations preserve callback transaction permissions", () => {
		scopedDb.transaction().execute(async (trx) => {
			expect(trx.withSchema("public")).type.toBe<typeof trx>();
			expect(trx.withPlugin(plugin)).type.toBe<typeof trx>();
			expect(trx.withoutPlugins()).type.toBe<typeof trx>();
			const transformed = trx
				.withSchema("public")
				.withPlugin(plugin)
				.withoutPlugins();
			transformed.updateTable("posts").set({ published: true });
			expect(transformed.updateTable).type.not.toBeCallableWith("users");
			expect(transformed.selectFrom).type.not.toBeCallableWith("secrets");
			expect(transformed.transaction).type.toBe<() => never>();
		});
	});

	test("schema and plugin transformations preserve controlled transaction permissions and savepoints", async () => {
		const trx = await scopedDb.startTransaction().execute();
		const saved = await trx.savepoint("saved").execute();
		expect(saved.withSchema("public")).type.toBe<typeof saved>();
		expect(saved.withPlugin(plugin)).type.toBe<typeof saved>();
		expect(saved.withoutPlugins()).type.toBe<typeof saved>();
		const transformed = saved
			.withSchema("public")
			.withPlugin(plugin)
			.withoutPlugins();
		transformed.updateTable("posts").set({ published: true });
		expect(transformed.updateTable).type.not.toBeCallableWith("users");
		expect(transformed.selectFrom).type.not.toBeCallableWith("secrets");
		const released = await transformed.releaseSavepoint("saved").execute();
		expect(released.rollbackToSavepoint).type.not.toBeCallableWith("saved");
		expect(released.updateTable).type.not.toBeCallableWith("users");
		expect(released.commit().execute()).type.toBe<Promise<void>>();
	});

	test("transaction callbacks preserve scoped permissions through builder configuration", () => {
		const result = scopedDb
			.transaction()
			.setAccessMode("read write")
			.setIsolationLevel("serializable")
			.execute(async (trx) => {
				trx.selectFrom("users").select("id");
				trx
					.insertInto("posts")
					.values({ id: 1, authorId: 2, published: false });
				trx
					.replaceInto("posts")
					.values({ id: 1, authorId: 2, published: false });
				trx
					.updateTable("posts as p")
					.set({ published: true })
					.where("p.id", "=", 1);
				trx.deleteFrom(["posts as p"]).where("p.id", "=", 1);
				trx
					.mergeInto("posts")
					.using("users", "users.id", "posts.authorId")
					.whenMatched()
					.thenUpdateSet({ published: true });
				expect(trx.insertInto).type.not.toBeCallableWith("users");
				expect(trx.replaceInto).type.not.toBeCallableWith("users");
				expect(trx.updateTable).type.not.toBeCallableWith("users");
				expect(trx.deleteFrom).type.not.toBeCallableWith("users");
				expect(trx.mergeInto).type.not.toBeCallableWith("users");
				expect(trx.selectFrom).type.not.toBeCallableWith("secrets");
				expect(trx.isTransaction).type.toBe<true>();
				expect(trx.transaction).type.toBe<() => never>();
				expect(trx.startTransaction).type.toBe<() => never>();
				return 1;
			});
		expect(result).type.toBe<Promise<number>>();
	});

	test("controlled transactions preserve scoped permissions and lifecycle methods", async () => {
		const trx = await scopedDb
			.startTransaction()
			.setIsolationLevel("serializable")
			.setAccessMode("read write")
			.execute();
		trx.selectFrom("users").select("id");
		trx.updateTable("posts").set({ published: true });
		expect(trx.insertInto).type.not.toBeCallableWith("users");
		expect(trx.replaceInto).type.not.toBeCallableWith("users");
		expect(trx.updateTable).type.not.toBeCallableWith("users");
		expect(trx.deleteFrom).type.not.toBeCallableWith("users");
		expect(trx.mergeInto).type.not.toBeCallableWith("users");
		expect(trx.selectFrom).type.not.toBeCallableWith("secrets");
		expect(trx.isTransaction).type.toBe<true>();
		expect(trx.isCommitted).type.toBe<boolean>();
		expect(trx.isRolledBack).type.toBe<boolean>();
		expect(trx.commit().execute()).type.toBe<Promise<void>>();
		expect(trx.rollback().execute()).type.toBe<Promise<void>>();
		expect(trx.transaction).type.toBe<() => never>();
		expect(trx.startTransaction).type.toBe<() => never>();
	});

	test("savepoint commands preserve permissions and native savepoint names", async () => {
		const trx = await scopedDb.startTransaction().execute();

		expect(trx.rollbackToSavepoint).type.not.toBeCallableWith("missing");
		expect(trx.releaseSavepoint).type.not.toBeCallableWith("missing");
		const saved = await trx.savepoint("saved").execute();
		saved.updateTable("posts").set({ published: true });
		expect(saved.updateTable).type.not.toBeCallableWith("users");
		expect(saved.selectFrom).type.not.toBeCallableWith("secrets");
		const rolledBack = await saved.rollbackToSavepoint("saved").execute();
		expect(rolledBack.deleteFrom).type.not.toBeCallableWith("users");
		const released = await rolledBack.releaseSavepoint("saved").execute();
		expect(released.insertInto).type.not.toBeCallableWith("users");
		expect(released.rollbackToSavepoint).type.not.toBeCallableWith("saved");
		expect(released.releaseSavepoint).type.not.toBeCallableWith("saved");
		expect(released.commit().execute()).type.toBe<Promise<void>>();
	});
});

describe("connections", () => {
	test("connections preserve scoped permissions, execution options, and result inference", () => {
		const result = scopedDb.connection().execute(
			async (connectionDb) => {
				expect(connectionDb).type.toBe<typeof scopedDb>();
				expect(connectionDb.withSchema("public")).type.toBe<typeof scopedDb>();
				expect(connectionDb.withPlugin(plugin)).type.toBe<typeof scopedDb>();
				expect(connectionDb.withoutPlugins()).type.toBe<typeof scopedDb>();
				connectionDb.selectFrom("users").select("id");
				connectionDb.updateTable("posts").set({ published: true });
				expect(connectionDb.insertInto).type.not.toBeCallableWith("users");
				expect(connectionDb.replaceInto).type.not.toBeCallableWith("users");
				expect(connectionDb.updateTable).type.not.toBeCallableWith("users");
				expect(connectionDb.deleteFrom).type.not.toBeCallableWith("users");
				expect(connectionDb.mergeInto).type.not.toBeCallableWith("users");
				expect(connectionDb.selectFrom).type.not.toBeCallableWith("secrets");
				return 1;
			},
			{ signal: new AbortController().signal },
		);
		expect(result).type.toBe<Promise<number>>();
	});

	test("transactions inside connections preserve write restrictions", () => {
		scopedDb.connection().execute(async (connectionDb) => {
			await connectionDb.transaction().execute(async (trx) => {
				trx.updateTable("posts").set({ published: true });
				expect(trx.updateTable).type.not.toBeCallableWith("users");
			});
			const trx = await connectionDb.startTransaction().execute();
			expect(trx.deleteFrom).type.not.toBeCallableWith("users");
		});
	});
});

describe("module imports and exports", () => {
	test("root access retains the original database type", () => {
		type RootDef = ModuleDef<{ imports: [typeof OrdersModule] }>;
		expect<RootDef["deps"]["rootDb"]>().type.toBe<Kysely<Database>>();
	});

	test("scopes do not re-export unrestricted root access", () => {
		expect<Def["deps"]>().type.not.toHaveProperty("rootDb");
	});

	test("importing root access does not widen scoped permissions", () => {
		type CombinedDef = ModuleDef<{
			imports: [typeof OrdersModule, typeof orders];
		}>;
		const { rootDb, scopedDb } = {} as CombinedDef["deps"];
		rootDb.updateTable("users");
		expect(scopedDb.updateTable).type.not.toBeCallableWith("users");
	});
});

describe("provider names", () => {
	test("custom provider names map to exact database types without extra aliases", () => {
		const NamedOrdersModule = createKyselyModuleFactory({
			db,
			rootProviderName: "orders",
			scopedProviderName: "orderQueries",
		});
		const AnalyticsModule = createKyselyModuleFactory({
			db: analyticsDb,
			rootProviderName: "analytics",
			scopedProviderName: "eventQueries",
		});
		const orders = NamedOrdersModule({
			readTables: ["posts", "users"],
			writeTables: ["posts"],
		});
		const analytics = AnalyticsModule({
			readTables: ["events"],
			writeTables: [],
		});
		type NamedDef = ModuleDef<{
			imports: [
				typeof NamedOrdersModule,
				typeof AnalyticsModule,
				typeof orders,
				typeof analytics,
			];
		}>;
		expect<Extract<keyof NamedDef["deps"], string>>().type.toBe<
			"orders" | "orderQueries" | "analytics" | "eventQueries"
		>();
		expect<NamedDef["deps"]["orders"]>().type.toBe<Kysely<Database>>();
		expect<NamedDef["deps"]["analytics"]>().type.toBe<
			Kysely<AnalyticsDatabase>
		>();
		expect<NamedDef["deps"]["orderQueries"]>().type.toBe<
			ScopedDatabase<Database, "posts" | "users", "posts">
		>();
		expect<NamedDef["deps"]["eventQueries"]>().type.toBe<
			ScopedDatabase<AnalyticsDatabase, "events", never>
		>();
	});

	test("omitted provider names retain their defaults independently", () => {
		const RootOnly = createKyselyModuleFactory({
			db,
			rootProviderName: "customRoot",
		});
		const ScopedOnly = createKyselyModuleFactory({
			db,
			scopedProviderName: "customScoped",
		});
		const defaultScoped = RootOnly({
			readTables: ["posts"],
			writeTables: ["posts"],
		});
		const customScoped = ScopedOnly({ readTables: ["users"], writeTables: [] });
		type PartialDef = ModuleDef<{
			imports: [
				typeof RootOnly,
				typeof ScopedOnly,
				typeof defaultScoped,
				typeof customScoped,
			];
		}>;
		expect<Extract<keyof PartialDef["deps"], string>>().type.toBe<
			"customRoot" | "rootDb" | "scopedDb" | "customScoped"
		>();
	});

	test("provider names must identify a single concrete key", () => {
		expect(createKyselyModuleFactory).type.not.toBeCallableWith({
			db,
			rootProviderName: wideName,
		});
		expect(createKyselyModuleFactory).type.not.toBeCallableWith({
			db,
			scopedProviderName: wideName,
		});
		expect(createKyselyModuleFactory).type.not.toBeCallableWith({
			db,
			rootProviderName: unionName,
		});
		expect(createKyselyModuleFactory).type.not.toBeCallableWith({
			db,
			scopedProviderName: unionName,
		});
		expect(createKyselyModuleFactory).type.not.toBeCallableWith({
			db,
			rootProviderName: patternName,
		});
		expect(createKyselyModuleFactory).type.not.toBeCallableWith({
			db,
			scopedProviderName: "",
		});
		expect(
			createKyselyModuleFactory<Database, "orders">,
		).type.not.toBeCallableWith({ db });
	});
});
