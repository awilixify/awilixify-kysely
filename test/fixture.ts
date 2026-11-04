import {
	DummyDriver,
	Kysely,
	PostgresAdapter,
	PostgresIntrospector,
	PostgresQueryCompiler,
} from "kysely";

export interface Database {
	users: { id: number; active: boolean };
	posts: { id: number; authorId: number; published: boolean };
	secrets: { id: number; value: string };
}

export function createTestDb() {
	const driver = new DummyDriver();
	const db = new Kysely<Database>({
		dialect: {
			createDriver: () => driver,
			createAdapter: () => new PostgresAdapter(),
			createIntrospector: (database) => new PostgresIntrospector(database),
			createQueryCompiler: () => new PostgresQueryCompiler(),
		},
	});

	return { db, driver };
}
