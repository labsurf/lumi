import 'dotenv/config';
import { drive } from './services/auth.js';

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

async function main() {
  console.log('🔍 Prueba de conexión con OAuth 2.0 (tu cuenta personal)...\n');

  // 1. Verificar acceso a la carpeta
  const folder = await drive.files.get({
    fileId: FOLDER_ID,
    fields: 'id, name, owners(emailAddress)',
  });
  console.log(`✅ Acceso OK a la carpeta: "${folder.data.name}"`);
  console.log(`   Propietario: ${folder.data.owners?.[0]?.emailAddress}\n`);

  // 2. Subir archivo de prueba
  const fileName = `test-${Date.now()}.txt`;
  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [FOLDER_ID],
    },
    media: {
      mimeType: 'text/plain',
      body: 'Hola desde OAuth 2.0 con mi propia cuota 🎵',
    },
    fields: 'id, name, size',
  });
  console.log(`✅ Archivo subido: "${created.data.name}" (${created.data.size} bytes)`);

  // 3. Listar archivos de la carpeta
  const list = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id, name, size, mimeType, createdTime)',
    orderBy: 'createdTime desc',
  });
  console.log(`\n📂 Archivos en la carpeta (${list.data.files.length}):`);
  list.data.files.forEach((f, i) => {
    console.log(`   ${i + 1}. ${f.name}  [${f.id}]`);
  });

  // 4. Borrar el archivo de prueba
  await drive.files.delete({ fileId: created.data.id });
  console.log(`\n🧹 Archivo de prueba eliminado.`);

  console.log('\n🎉 ¡TODO FUNCIONA! OAuth 2.0 operativo. Drive listo para producción.\n');
}

main().catch((err) => {
  console.error('\n💥 Error:', err.message);
  if (err.message.includes('storageQuota')) {
    console.error('   → Revisa que el refresh token sea de TU cuenta personal.');
  }
  if (err.message.includes('notFound')) {
    console.error('   → Folder ID incorrecto o no tienes acceso.');
  }
  process.exit(1);
});