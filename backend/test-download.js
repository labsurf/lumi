import 'dotenv/config';
import { downloadAndUpload } from './services/ytDlp.js';

// Uso: node test-download.js "query youtube" "Nombre para mostrar"
const query = process.argv[2] || 'Bad Bunny Monaco';
const displayName = process.argv[3] || query;

console.log(`🚀 Probando descarga: "${query}"`);
console.log(`   Nombre para Drive: "${displayName}"\n`);

try {
  const file = await downloadAndUpload(query, displayName);
  console.log('\n🎉 ¡Descarga y subida exitosa!');
  console.log(`   Archivo: ${file.name}`);
  console.log(`   ID Drive: ${file.id}`);
  console.log(`   Tamaño: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
} catch (err) {
  console.error('\n💥 Error:', err.message);
  process.exit(1);
}