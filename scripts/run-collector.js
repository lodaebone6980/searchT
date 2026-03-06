import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/index.js';
import CollectorEngine from '../src/collectors/CollectorEngine.js';
import Profile from '../src/models/Profile.js';

async function run() {
  await mongoose.connect(config.mongodb.uri);
  console.log('Connected to MongoDB');

  const engine = new CollectorEngine();
  const targetUsername = process.argv[2];

  if (targetUsername) {
    const profile = await Profile.findOne({ username: targetUsername });
    if (!profile) {
      console.log('Profile not found: @' + targetUsername);
      process.exit(1);
    }
    console.log('Collecting for @' + targetUsername + '...');
    await engine.collectProfileThreads(profile);
  } else {
    console.log('Running full collection cycle...');
    await engine.runCollectionCycle();
  }

  console.log('Stats:', engine.getStats());
  await mongoose.disconnect();
}

run().catch(console.error);
