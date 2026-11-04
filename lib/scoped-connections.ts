import type { ConnectionBuilder } from "kysely";
import type { ScopedDatabase, TableName } from "./scoped-database.js";

type ScopedConnectionBuilder<DB, Write extends TableName<DB>> = Omit<
	ConnectionBuilder<DB>,
	"execute"
> & {
	execute<T>(
		callback: (db: ScopedDatabase<DB, TableName<DB>, Write>) => Promise<T>,
		options?: Parameters<ConnectionBuilder<DB>["execute"]>[1],
	): Promise<T>;
};

export type ScopedConnections<DB, Write extends TableName<DB>> = {
	connection(): ScopedConnectionBuilder<DB, Write>;
};
