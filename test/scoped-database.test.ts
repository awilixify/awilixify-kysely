import { describe, expect, it, vi } from "vitest";
import { createScopedDatabase } from "../lib/scoped-database.js";
import { createTestDb } from "./fixture.js";

const scope = {
	readTables: ["posts", "users"],
	writeTables: ["posts"],
} as const;

function fixture() {
	return createScopedDatabase(createTestDb().db, scope);
}

describe("scoped database", () => {
	it("allows readable tables in mutation subqueries", () => {
		const db = fixture();
		const query = db
			.updateTable("posts")
			.set({ published: true })
			.where((eb) =>
				eb.exists(
					eb
						.selectFrom("users")
						.select("users.id")
						.whereRef("users.id", "=", "posts.authorId")
						.where("users.active", "=", true),
				),
			)
			.compile();

		expect(query.sql).toBe(
			'update "posts" set "published" = $1 where exists (select "users"."id" from "users" where "users"."id" = "posts"."authorId" and "users"."active" = $2)',
		);
		expect(query.parameters).toEqual([true, true]);
		expect(db.selectFrom("users as u").select("u.id").compile().sql).toBe(
			'select "u"."id" from "users" as "u"',
		);
	});

	it("only exposes scoped queries and transactions", () => {
		expect(Object.keys(fixture())).toEqual([
			"selectFrom",
			"insertInto",
			"updateTable",
			"deleteFrom",
			"transaction",
		]);
	});

	it("rejects forbidden mutation targets even if types are bypassed", () => {
		const db = fixture();
		for (const method of ["insertInto", "updateTable", "deleteFrom"] as const) {
			// @ts-expect-error Deliberately exercise the JavaScript runtime boundary.
			expect(() => db[method]("users")).toThrow(
				'Table "users" is not writable',
			);
		}
	});

	it("rejects writable tables missing from readable tables", () => {
		expect(() =>
			createScopedDatabase(createTestDb().db, {
				readTables: ["users"],
				// @ts-expect-error Deliberately exercise invalid JavaScript configuration.
				writeTables: ["posts"],
			}),
		).toThrow('Writable table "posts" must also be readable');
	});

	it("preserves permissions and transaction settings on a single connection", async () => {
		const { db: root, driver } = createTestDb();
		const begin = vi.spyOn(driver, "beginTransaction");
		const commit = vi.spyOn(driver, "commitTransaction");
		const acquire = vi.spyOn(driver, "acquireConnection");
		const db = createScopedDatabase(root, scope);

		try {
			const result = await db
				.transaction()
				.setIsolationLevel("serializable")
				.setAccessMode("read write")
				.execute(async (trx) => {
					expect(Object.keys(trx)).toEqual([
						"selectFrom",
						"insertInto",
						"updateTable",
						"deleteFrom",
					]);
					// @ts-expect-error Transactions retain runtime mutation checks too.
					expect(() => trx.updateTable("users")).toThrow(
						'Table "users" is not writable',
					);
					await trx.selectFrom("users").selectAll().execute();
					await trx.updateTable("posts").set({ published: true }).execute();
					return 42;
				});
			expect(result).toBe(42);
			expect(begin).toHaveBeenCalledWith(expect.anything(), {
				isolationLevel: "serializable",
				accessMode: "read write",
			});
			expect(commit).toHaveBeenCalledOnce();
			expect(acquire).toHaveBeenCalledOnce();
		} finally {
			await root.destroy();
		}
	});

	it("rolls back and propagates callback errors", async () => {
		const { db: root, driver } = createTestDb();
		const rollback = vi.spyOn(driver, "rollbackTransaction");
		const commit = vi.spyOn(driver, "commitTransaction");
		const db = createScopedDatabase(root, scope);
		const error = new Error("Abort");
		try {
			await expect(
				db.transaction().execute(async (trx) => {
					await trx.deleteFrom("posts").where("id", "=", 1).execute();
					throw error;
				}),
			).rejects.toBe(error);
			expect(rollback).toHaveBeenCalledOnce();
			expect(commit).not.toHaveBeenCalled();
		} finally {
			await root.destroy();
		}
	});
});
