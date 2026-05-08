import 'dotenv/config';
import pgMigrate from 'node-pg-migrate';

const migrate = pgMigrate.default ?? pgMigrate;
const direction = process.argv[2] || 'up';

const databaseUrl =
  process.env.DATABASE_URL ||
  `postgres://${process.env.PGUSER || 'postgres'}:${process.env.PGPASSWORD || 'postgres'}` +
    `@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}` +
    `/${process.env.PGDATABASE || 'msuactivity'}`;

migrate({
  databaseUrl,
  dir: 'migrations',
  direction,
  migrationsTable: 'pgmigrations',
  log: (msg) => console.log(msg),
})
  .then((migrations) => {
    console.log(`Done. Direction=${direction}, applied ${migrations.length} migration(s).`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
