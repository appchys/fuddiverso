const admin = require('firebase-admin');
const fs = require('fs');
const csv = require('csv-parser');

// Initialize Firebase Admin SDK
const serviceAccount = require('./multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Path to the CSV file
const csvFilePath = './ubicaciones.csv'; // Replace with the actual path to your CSV file

// Function to normalize column names
function normalizeColumnName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

// Function to import data from CSV to Firestore
async function importCSV() {
  const ubicacionesCollection = db.collection('ubicaciones');

  const rows = [];

  fs.createReadStream(csvFilePath)
    .pipe(csv({
      mapHeaders: ({ header }) => normalizeColumnName(header)
    }))
    .on('data', (row) => {
      console.log('Row read from CSV:', row); // Debugging: Log each row

      const { id, ...ubicacionData } = row;

      // Validate id
      if (!id || id.trim() === '') {
        console.warn(`Skipping row with empty id:`, row);
        return;
      }

      rows.push({ id, data: { id, ...ubicacionData } }); // Include `id` in the data
    })
    .on('end', async () => {
      console.log(`Processing ${rows.length} rows...`);

      if (rows.length === 0) {
        console.error('No valid rows found in the CSV file.');
        return;
      }

      const batch = db.batch();

      rows.forEach(({ id, data }) => {
        // Validar que el ID sea válido
        if (!id || id.trim() === '' || id.includes(',')) {
          console.warn(`Fila omitida debido a un ID inválido: ${id}`);
          return;
        }

        const ubicacionRef = ubicacionesCollection.doc(id);
        batch.set(ubicacionRef, data);
      });

      try {
        await batch.commit();
        console.log('CSV data successfully imported to Firestore!');
      } catch (error) {
        console.error('Error importing data:', error);
      }
    })
    .on('error', (error) => {
      console.error('Error reading the CSV file:', error);
    });
}

// Run the import function
importCSV();
