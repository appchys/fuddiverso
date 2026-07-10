const admin = require('firebase-admin');
const serviceAccount = require('../sa_key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log("Fetching whatsAppTemplates...");
  const snapshot = await db.collection('whatsAppTemplates').get();
  snapshot.forEach(doc => {
    console.log(`Document ID: ${doc.id}`);
    console.log(`Data:`, doc.data());
    console.log(`------------------------------------------`);
  });
}

run().catch(console.error);
