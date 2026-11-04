# @awilixify/kysely

Module-scoped Kysely access for awilixify. Share one database instance and pool while giving each feature module its own readable tables and mutation targets.

Requires Node.js 22+, awilixify 3.4+, and Kysely 0.29.8+. ESM only. Direct factories work with awilixify 3.4.0; wrapping a callable factory with `configureModule` requires the callable-factory support added alongside this package, which is not yet in the published 3.4.0 release.

## Install

```sh
npm install @awilixify/kysely awilixify awilix kysely
```

Install your dialect's driver separately, for example `pg` and the development dependency `@types/pg` for PostgreSQL. This package does not depend on a database driver.

## Create the dynamic module factory

The application creates and owns its Kysely instance. Database types remain application-owned too.

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

`DatabaseModule` is both a root module exporting `db` and a callable dynamic-module factory. Each call returns an ordinary module exporting one restricted `db` provider:

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

// PostsDef["deps"]["db"] is ScopedDatabase<Database, "posts" | "users", "posts">.
// Reads may reference posts and users; mutation targets must be posts.
```

Each scope wraps the same captured Kysely instance, without creating another instance or pool. It does not import the unrestricted root provider. Importing `DatabaseModule` itself deliberately gives full `Kysely<Database>` access; importing `DatabaseModule({ ... })` gives `ScopedDatabase` access under the same `db` name.

Use one database scope per feature module. Importing several scopes, or both the root and a scope, into the same consumer would collide on `db`. Import feature modules without re-exporting their database providers.

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

`ConfigModule` is your application's module exporting `config`. Feature modules still call `DatabaseModule({ readTables, writeTables })` as shown above. The generic database type and table allowlists are preserved.

Calls to a configured factory are deferred until `DIContext.create()`. Reuse the same `DatabaseModule` descriptor so the factory and database initialize once per context. The Kysely package itself never calls `configureModule` or hides configuration in another overload. As with `configureModule` generally, this configured form uses synchronous `DIContext`, not `AsyncDIContext`.

## Permissions

- `readTables` determines the schema available to selects, joins, and subqueries.
- `writeTables` determines the allowed insert, update, and delete targets. Every writable table must also be readable.
- An empty `writeTables` array gives no mutation targets.
- Read queries support Kysely's normal table aliases. Mutation entry points accept registered table names only, not aliases, raw expressions, or multiple targets.

An update can read another permitted table without being allowed to mutate it:

```ts
async function publishPosts({ db }: PostsDef["deps"]) {
  await db
    .updateTable("posts")
    .set({ published: true })
    .where((eb) =>
      eb.exists(
        eb.selectFrom("users")
          .select("users.id")
          .whereRef("users.id", "=", "posts.authorId")
          .where("users.active", "=", true),
      ),
    )
    .execute();

  // db.updateTable("users"); // Type error
}
```

## Transactions

The scoped `db` exposes callback-based transactions. Both table permissions are preserved inside the callback:

```ts
async function publishAtomically({ db }: PostsDef["deps"]) {
  return db.transaction()
    .setIsolationLevel("serializable")
    .execute(async (trx) => {
      await trx.selectFrom("users").select("id").execute();
      await trx.updateTable("posts").set({ published: true }).execute();
      // trx.updateTable("users"); // Type error
      return "published";
    });
}
```

`setAccessMode` is also supported. Callback results, commits, and rollbacks use Kysely's normal behavior. The transaction callback receives a `ScopedTransaction`, not the full Kysely transaction. Nested and manually controlled transactions are not exposed.

The package exports `ScopedDatabase`, `ScopedTransaction`, and `ScopedTransactionBuilder` types for explicit annotations. Schema management, lifecycle, and unrestricted connection APIs remain root-only.

## Runtime limits

Scope creation checks that writable tables are readable. Mutation entry points also check their target against a copied allowlist at runtime, including calls from JavaScript or through unsafe casts.

This version does **not** include a query-tree permission plugin. Read restrictions are compile-time only. Builders retain Kysely's raw-expression support and advanced dialect-specific methods; those are not a sandbox. Raw SQL, unsafe casts, views, triggers, functions, or dialect-specific multi-table mutations can bypass the intended boundaries. CTE, schema-management, and unrestricted connection-management entry points are not exposed. Callback transactions retain the same runtime mutation-target checks.

These permissions prevent ordinary application mistakes. Use database grants for security enforcement.

## Lifecycle

All scoped databases and transactions use the supplied database's driver and pool. The package never calls `destroy()`. The owning application must call `db.destroy()` once during shutdown, after database work has finished. For a DI-created instance, arrange that cleanup in its owning provider's shutdown hook.

## Development

```sh
npm ci
npm run lint
npm run check-types
npm test
npm run build
```

Uses TypeScript, Biome, and Vitest, matching awilixify's tooling. `check-types` also checks the negative permission cases in `test/permissions.types.ts` using `@ts-expect-error`. Tests use Kysely's dummy driver and need no database server.

`npm pack` runs lint, type checks, tests, and build before packaging. The package is independent of the sibling awilixify checkout and uses the published peer dependency. Callable `configureModule` behavior is tested in awilixify itself; the package tests exercise the ordinary root and scoped modules.
