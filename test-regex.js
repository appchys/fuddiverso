const text = `[16/6/26, 4:54:15 p. m.] Carla Castro León: Ubicación: https://maps.google.com/?q=-1.857296,-79.975029
 [16/6/26, 4:54:46 p. m.] Carla Castro León: Afrente del portal de los caicedos el que queda adentro`;

const lines = text.split('\n');
const regex = /^\[?\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s*[^\]\-]*?[\]\-]\s*[^:]+:\s*(.*)$/i;

for (const line of lines) {
  const cleanLine = line.trim();
  const match = cleanLine.match(regex);
  console.log('Line:', JSON.stringify(cleanLine));
  console.log('Match:', match ? match[1] : 'NO MATCH');
}
