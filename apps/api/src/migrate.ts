import { migrate } from '@timon/db';
import { connect } from './database.ts';

const { db, close } = connect();
try {
  const applied = await migrate(db);
  console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await close();
}
