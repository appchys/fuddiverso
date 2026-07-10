const admin = require('firebase-admin');
const serviceAccount = require('../sa_key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log("Fetching settings/general...");
  const doc = await db.collection('settings').doc('general').get();
  if (!doc.exists) {
    console.log("Document settings/general does not exist!");
  } else {
    console.log("settings/general data:", doc.data());
  }

  console.log("\nFetching settings/admin_telegram...");
  const adminDoc = await db.collection('settings').doc('admin_telegram').get();
  if (!adminDoc.exists) {
    console.log("Document settings/admin_telegram does not exist!");
  } else {
    console.log("settings/admin_telegram data:", adminDoc.data());
  }
}

run().catch(console.error);
