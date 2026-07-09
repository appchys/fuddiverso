const admin = require('firebase-admin');
const serviceAccount = require('../sa_key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log("Fetching all businesses...");
  const snapshot = await db.collection('businesses').get();

  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`ID: ${doc.id} | Name: ${data.name} | Username: ${data.username}`);
  });
}

run().catch(console.error);
