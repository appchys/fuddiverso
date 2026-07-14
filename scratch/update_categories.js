const admin = require("firebase-admin");
const serviceAccount = require("../sa_key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log("Fetching products...");
  const querySnapshot = await db.collection("products").get();
  console.log(`Found ${querySnapshot.size} products. Checking categories...`);
  
  let count = 0;
  const batch = db.batch();
  
  querySnapshot.forEach(doc => {
    const data = doc.data();
    const cat = data.category;
    if (cat === "Sin categoría" || cat === "Sin categoria") {
      console.log(`Queueing update for product: ${data.name} (${doc.id}) - Category: "${cat}" -> ""`);
      const docRef = db.collection("products").doc(doc.id);
      batch.update(docRef, { category: "" });
      count++;
    }
  });

  if (count > 0) {
    console.log(`Committing batch update for ${count} products...`);
    await batch.commit();
    console.log("Batch update committed successfully!");
  } else {
    console.log("No products needed updating.");
  }
  
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
