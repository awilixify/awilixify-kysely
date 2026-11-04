import { createModule, DIContext, type ModuleDef } from "awilixify";
import { describe, expect, it, vi } from "vitest";
import { createKyselyModuleFactory, type ScopedDatabase } from "../index.js";
import { createTestDb, type Database } from "./fixture.js";

describe("KyselyModuleFactory", () => {
	it("shares the root driver while exporting a scoped db per feature", async () => {
		const { db, driver } = createTestDb();

		const acquire = vi.spyOn(driver, "acquireConnection");
		const destroy = vi.spyOn(driver, "destroy");

		const DatabaseModule = createKyselyModuleFactory({ db });
		const postsDb = DatabaseModule({
			readTables: ["posts", "users"],
			writeTables: ["posts"],
		});
		const usersDb = DatabaseModule({
			readTables: ["users"],
			writeTables: ["users"],
		});
		expect(postsDb.exports).toEqual(["db"]);
		expect(usersDb.exports).toEqual(["db"]);
		expect(typeof postsDb).toBe("object");
		expect(postsDb.providers).toHaveProperty("db");

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

		try {
			expect(context.scope.resolve("db")).toBe(db);
			const postsScope = context.importedScopes.get("Posts");
			const usersScope = context.importedScopes.get("Users");
			expect(postsScope).toBeDefined();
			expect(usersScope).toBeDefined();
			expect(postsScope?.scope.resolve("db")).not.toBe(db);
			expect(usersScope?.scope.resolve("db")).not.toBe(db);
			await postsScope?.scope
				.resolve<ScopedDatabase<Database, "posts" | "users", "posts">>("db")
				.selectFrom("posts")
				.selectAll()
				.execute();
			await usersScope?.scope
				.resolve<ScopedDatabase<Database, "users", "users">>("db")
				.selectFrom("users")
				.selectAll()
				.execute();
			expect(acquire).toHaveBeenCalledTimes(2);
			await context.close();
			expect(destroy).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
		expect(destroy).toHaveBeenCalledTimes(1);
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
