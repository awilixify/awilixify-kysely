import type { ModuleDef } from "awilixify";
import type { Kysely } from "kysely";
import { createKyselyModuleFactory } from "../index.js";
import type { Database } from "./fixture.js";

// Checked by tsc, not executed. Each expected error must remain an error.
export function checkPermissions(root: Kysely<Database>): unknown {
	const DatabaseModule = createKyselyModuleFactory({ db: root });
	const scoped = DatabaseModule({
		readTables: ["posts", "users"],
		writeTables: ["posts"],
	});
	type Def = ModuleDef<{ imports: [typeof scoped] }>;

	function checkQueries({ db }: Def["deps"]) {
		db.selectFrom("users as u").select("u.id");
		db.insertInto("posts").values({ id: 1, authorId: 2, published: false });
		db.updateTable("posts").set({ published: true });
		db.deleteFrom("posts").where("id", "=", 1);
		// @ts-expect-error Unregistered tables cannot be read.
		db.selectFrom("secrets");
		// @ts-expect-error Unregistered tables cannot be joined.
		db.selectFrom("posts").innerJoin("secrets", "secrets.id", "posts.id");
		// @ts-expect-error Readable does not mean writable.
		db.updateTable("users");
		// @ts-expect-error Readable does not mean insertable.
		db.insertInto("users");
		// @ts-expect-error Readable does not mean deletable.
		db.deleteFrom("users");
		// @ts-expect-error Preserve column value types.
		db.updateTable("posts").set({ published: "yes" });
		// @ts-expect-error Do not expose lifecycle access.
		db.destroy();
		// @ts-expect-error Do not expose schema management.
		db.schema.createTable("secrets");
		// @ts-expect-error Do not expose unrestricted connections.
		db.connection();
		// @ts-expect-error A scoped db is not the full root instance.
		const unrestricted: Kysely<Database> = db;

		const result: Promise<number> = db
			.transaction()
			.setIsolationLevel("serializable")
			.setAccessMode("read write")
			.execute(async (trx) => {
				trx.selectFrom("users").select("id");
				trx.updateTable("posts").set({ published: true });
				// @ts-expect-error Transactions retain write permissions.
				trx.updateTable("users");
				// @ts-expect-error Transactions retain read permissions.
				trx.selectFrom("secrets");
				// @ts-expect-error Nested transactions are not supported by Kysely.
				trx.transaction();
				// @ts-expect-error Transactions cannot expose the full database either.
				trx.schema.createTable("secrets");
				return 42;
			});
		return { result, unrestricted };
	}

	const readOnly = DatabaseModule({ readTables: ["users"], writeTables: [] });
	type ReadOnlyDef = ModuleDef<{ imports: [typeof readOnly] }>;
	function checkReadOnly({ db }: ReadOnlyDef["deps"]) {
		db.selectFrom("users");
		// @ts-expect-error Empty writeTables allows no mutation targets.
		db.updateTable("users");
		return db.transaction().execute(async (trx) => {
			// @ts-expect-error Transactions cannot widen read-only scopes.
			trx.insertInto("users");
		});
	}

	DatabaseModule({
		readTables: ["users"],
		// @ts-expect-error Mutation targets must also be readable.
		writeTables: ["posts"],
	});
	DatabaseModule({
		// @ts-expect-error Unknown database table.
		readTables: ["unknown"],
		writeTables: [],
	});

	type RootDef = ModuleDef<{ imports: [typeof DatabaseModule] }>;
	function checkRoot({ db }: RootDef["deps"]) {
		const original: Kysely<Database> = db;
		return original;
	}
	// @ts-expect-error Only the explicit options shape is accepted.
	createKyselyModuleFactory(root);
	// @ts-expect-error Dependency configuration belongs to configureModule.
	createKyselyModuleFactory({ useFactory: () => root });
	checkRoot({ db: root });

	return { checkQueries, checkReadOnly };
}
