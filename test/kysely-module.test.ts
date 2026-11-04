import { createModule, DIContext, type ModuleDef } from "awilixify";
import { describe, expect, it, vi } from "vitest";
import { createKyselyModuleFactory, type ScopedDatabase } from "../index.js";
import { createTestDb, type Database } from "./fixture.js";

describe("KyselyModuleFactory", () => {
	it("exports the same db through each feature's scoped types", async () => {
		const { db, driver } = createTestDb();

		const acquire = vi.spyOn(driver, "acquireConnection");

		const DatabaseModule = createKyselyModuleFactory({ db });
		const postsDb = DatabaseModule({
			readTables: ["posts", "users"],
			writeTables: ["posts"],
		});
		const usersDb = DatabaseModule({
			readTables: ["users"],
			writeTables: ["users"],
		});

		type PostsDef = ModuleDef<{ imports: [typeof postsDb] }>;
		type UsersDef = ModuleDef<{ imports: [typeof usersDb] }>;
		const context = DIContext.create({
			name: "App",
			imports: [
				DatabaseModule,
				createModule<PostsDef>({ name: "Posts", imports: [postsDb] }),
				createModule<UsersDef>({ name: "Users", imports: [usersDb] }),
			],
		});

		const postsScope = context.importedScopes.get("Posts");
		const usersScope = context.importedScopes.get("Users");

		expect(context.scope.resolve("rootDb")).toBe(db);
		expect(postsScope?.scope.resolve("scopedDb")).toBe(db);
		expect(usersScope?.scope.resolve("scopedDb")).toBe(db);
		expect(postsScope?.scope.hasRegistration("rootDb")).toBe(false);
		expect(usersScope?.scope.hasRegistration("rootDb")).toBe(false);
		expect(postsDb.imports).toEqual([DatabaseModule]);
		expect(usersDb.imports).toEqual([DatabaseModule]);
		expect(postsDb.exports).toEqual(["scopedDb"]);
		expect(usersDb.exports).toEqual(["scopedDb"]);

		await postsScope?.scope
			.resolve<ScopedDatabase<Database, "posts" | "users", "posts">>("scopedDb")
			.selectFrom("posts")
			.selectAll()
			.execute();
		await usersScope?.scope
			.resolve<ScopedDatabase<Database, "users", "users">>("scopedDb")
			.selectFrom("users")
			.selectAll()
			.execute();

		expect(acquire).toHaveBeenCalledTimes(2);
	});

	it("allows root and scoped access in the same consumer", () => {
		const { db } = createTestDb();
		const DatabaseModule = createKyselyModuleFactory({ db });
		const context = DIContext.create({
			name: "App",
			imports: [
				DatabaseModule,
				DatabaseModule({ readTables: ["users"], writeTables: [] }),
			],
		});
		expect(context.scope.resolve("rootDb")).toBe(db);
		expect(context.scope.resolve("scopedDb")).toBe(db);
	});

	it("uses exact custom provider names for multiple databases", () => {
		const orders = createTestDb().db;
		const analytics = createTestDb().db;
		const OrdersModule = createKyselyModuleFactory({
			db: orders,
			rootProviderName: "orders",
			scopedProviderName: "orderQueries",
		});
		const AnalyticsModule = createKyselyModuleFactory({
			db: analytics,
			rootProviderName: "analytics",
			scopedProviderName: "eventQueries",
		});
		const context = DIContext.create({
			name: "App",
			imports: [
				OrdersModule,
				AnalyticsModule,
				OrdersModule({ readTables: ["posts"], writeTables: ["posts"] }),
				AnalyticsModule({ readTables: ["users"], writeTables: [] }),
			],
		});

		expect(context.scope.resolve("orders")).toBe(orders);
		expect(context.scope.resolve("orderQueries")).toBe(orders);
		expect(context.scope.resolve("analytics")).toBe(analytics);
		expect(context.scope.resolve("eventQueries")).toBe(analytics);
		expect(context.scope.hasRegistration("rootDb")).toBe(false);
		expect(context.scope.hasRegistration("scopedDb")).toBe(false);
	});

	it("rejects provider names that would collide inside a factory", () => {
		const { db } = createTestDb();
		expect(() =>
			createKyselyModuleFactory({
				db,
				rootProviderName: "same",
				scopedProviderName: "same",
			}),
		).toThrow("distinct");
		expect(() =>
			createKyselyModuleFactory({ db, rootProviderName: "kyselyLifecycle" }),
		).toThrow("reserved");
	});

	it.each([false, true])("destroyOnShutdown: %s", async (destroyOnShutdown) => {
		const { db } = createTestDb();
		const destroy = vi.spyOn(db, "destroy");
		const DatabaseModule = createKyselyModuleFactory({ db, destroyOnShutdown });
		const context = DIContext.create({
			name: "App",
			imports: [
				DatabaseModule,
				DatabaseModule({ readTables: ["users"], writeTables: [] }),
			],
		});
		await context.init();
		await context.close();
		expect(destroy).toHaveBeenCalledTimes(destroyOnShutdown ? 1 : 0);
	});

	it("validates permissions when creating an ordinary scoped module", () => {
		const DatabaseModule = createKyselyModuleFactory({
			db: createTestDb().db,
		});
		expect(() =>
			DatabaseModule({
				readTables: ["users"],
				// @ts-expect-error Invalid JavaScript input must also fail at runtime.
				writeTables: ["posts"],
			}),
		).toThrow('Writable table "posts" must also be readable');
	});
});
