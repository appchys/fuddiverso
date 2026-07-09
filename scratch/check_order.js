const admin = require('firebase-admin');
const serviceAccount = require('../sa_key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log("Fetching the 5 most recent orders...");
  const snapshot = await db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();

  if (snapshot.empty) {
    console.log("No orders found.");
    return;
  }

  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`\n==========================================`);
    console.log(`Order ID: ${doc.id}`);
    console.log(`Created At: ${data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt}`);
    console.log(`Status: ${data.status}`);
    console.log(`Delivery Object:`, JSON.stringify(data.delivery, null, 2));
    console.log(`Telegram Delivery Message:`, JSON.stringify(data.telegramDeliveryMessage, null, 2));
  });
}

run().catch(console.error);
