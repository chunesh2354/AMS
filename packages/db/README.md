# packages/db

SQL migrations for the API database, in `migrations/`.

Migrations are applied in filename order (`001_...`, `002_...`) by `migrate()` in `apps/api/src/dev/db.ts`. Name a new migration with the next number; never edit one that has already been applied.
