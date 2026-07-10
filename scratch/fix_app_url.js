const admin = require('firebase-admin');
const serviceAccount = require('../sa_key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log("Setting settings/general...");
  await db.collection('settings').doc('general').set({
    appUrl: 'https://fuddi.shop',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  console.log("Reading settings/general to verify...");
  const doc = await db.collection('settings').doc('general').get();
  console.log("settings/general data:", doc.data());
}

run().catch(console.error);
