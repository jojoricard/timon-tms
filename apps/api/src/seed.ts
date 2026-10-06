import { seed } from '@timon/db';
import { connect } from './database.ts';

const { db, close } = connect();
try {
  const written = await seed(db);
  console.log(written ? 'Demo haulier written.' : 'Resources already exist; nothing written.');
} finally {
  await close();
}
