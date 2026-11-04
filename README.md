# @awilixify/kysely

Module-scoped Kysely types for awilixify. Keep Kysely's full API while catching common table-access mistakes at compile time.

## Install

```sh
npm install @awilixify/kysely awilixify awilix kysely
```

Install your dialect's driver separately, for example `pg` and the development dependency `@types/pg` for PostgreSQL. This package does not depend on a database driver.

## Create the module factory

The application creates and owns the Kysely instance and its database types:

```ts
import { createKyselyModuleFactory } from "@awilixify/kysely";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

interface Database {
  users: { id: number; active: boolean };
  posts: { id: number; authorId: number; published: boolean };
}

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});

export const DatabaseModule = createKyselyModuleFactory({ db });
```

Each feature declares its readable tables and writable targets:

```ts
import { createModule, type ModuleDef } from "awilixify";
import { DatabaseModule } from "./database.js";

const PostsDatabaseModule = DatabaseModule({
  readTables: ["posts", "users"],
  writeTables: ["posts"],
});

type PostsDef = ModuleDef<{ imports: [typeof PostsDatabaseModule] }>;

export const PostsModule = createModule<PostsDef>({
  name: "PostsModule",
  imports: [PostsDatabaseModule],
});

async function publish({ scopedDb }: PostsDef["deps"]) {
  await scopedDb.updateTable("posts").set({ published: true }).execute();
  await scopedDb.selectFrom("users").select("id").execute();
  // scopedDb.updateTable("users"); // Type error: readable, but not writable.
}
```

Every scoped module exports `scopedDb`. It is the **same original Kysely instance**, not a proxy, wrapper, copy, or new connection pool. Only its TypeScript view changes. No native method is replaced or hidden.

- Importing `DatabaseModule` directly exports `rootDb: Kysely<Database>`.
- Importing `DatabaseModule({ ... })` exports `scopedDb: ScopedDatabase<...>`.

## Custom provider names

Use flat options to choose the exact exported keys, for example when importing two databases:

```ts
const OrdersModule = createKyselyModuleFactory({
  db: ordersDb,
  rootProviderName: "orders",
  scopedProviderName: "orderQueries",
});

const AnalyticsModule = createKyselyModuleFactory({
  db: analyticsDb,
  rootProviderName: "analytics",
  scopedProviderName: "eventQueries",
});
```

Root imports now export `orders` and `analytics`; scoped imports export `orderQueries` and `eventQueries`. Omitted options keep `rootDb` and `scopedDb`

## Configure the factory explicitly

If configuration comes from DI, wrap only factory creation with awilixify's `configureModule`:

```ts
import { configureModule } from "awilixify";

export const DatabaseModule = configureModule({
  imports: [ConfigModule],
  inject: ["config"],
  useFactory: (config) =>
    createKyselyModuleFactory({
      db: new Kysely<Database>({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: config.databaseUrl }),
        }),
      }),
    }),
});
```

## Type constraints

- `readTables` determines the schema available to normal typed queries, joins, subqueries, and expression helpers.
- `writeTables` narrows named targets of `insertInto`, `replaceInto`, `mergeInto`, `updateTable`, and `deleteFrom`. Every writable table must also be readable.
- An empty `writeTables` array allows no named mutation targets.
- `with()` and `withRecursive()` preserve permissions in callbacks and chained queries. CTE names are readable-only, even when shadowing a writable table; mutation CTEs may write to tables in `writeTables`.

### Type-safety limits

All typed query APIs on `scopedDb` preserve scoped permissions, including transactions, connections, CTEs, and schema/plugin chains, except:

- `$extendTables()`, `$pickTables()`, `$omitTables()`, and legacy `withTables()` return native types without scoped write restrictions.
- Raw SQL, `executeQuery()`, `getExecutor()`, and dynamic or expression-based mutation targets bypass named-table checks.
- Native schema-management and introspection APIs remain unrestricted.

`withSchema()` and plugins retain the scoped types but can redirect or transform SQL. Unsafe casts also bypass type checks.

These are compile-time guardrails, not runtime authorization. Use database roles and grants to enforce access.

## Lifecycle

`destroyOnShutdown` defaults to `true`: the root module calls `db.destroy()` once per context during `onShutdown`. Use `await context.init()` and `await context.close()`. Disable cleanup if another owner manages the database:

```ts
const DatabaseModule = createKyselyModuleFactory({
  db,
  destroyOnShutdown: false,
});
```

## Development

```sh
npm ci
npm run lint
npm run check-types
npm test
npm run build
```
