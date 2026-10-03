import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { URL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_FILE = path.resolve(__dirname, './credentials/oauth-client.json');

if (!fs.existsSync(CLIENT_FILE)) {
  console.error(`❌ No se encontró: ${CLIENT_FILE}`);
  process.exit(1);
}

const clientData = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8')).web;

const oauth2Client = new google.auth.OAuth2(
  clientData.client_id,
  clientData.client_secret,
  'http://localhost:3000/oauth2callback'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

console.log('\n═══════════════════════════════════════════════════');
console.log('🔗 Abre esta URL en tu navegador:');
console.log('═══════════════════════════════════════════════════\n');
console.log(authUrl);
console.log('\n═══════════════════════════════════════════════════');
console.log('⏳ Esperando autorización...');
console.log('═══════════════════════════════════════════════════\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');

  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>❌ Error: ${error}</h1>`);
    console.error('❌ Error de autorización:', error);
    server.close();
    return;
  }

  if (!code) {
    res.writeHead(400);
    res.end('No se recibió código');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1>✅ ¡Autorización completada!</h1>
        <p>Vuelve a la terminal para copiar tu refresh_token.</p>
        <p>Puedes cerrar esta pestaña.</p>
      </body></html>
    `);

    console.log('\n═══════════════════════════════════════════════════');
    console.log('✅ TOKENS RECIBIDOS');
    console.log('═══════════════════════════════════════════════════\n');
    console.log('👉 REFRESH TOKEN (copia esta línea completa):\n');
    console.log(tokens.refresh_token);
    console.log('\n═══════════════════════════════════════════════════\n');

    // Guardarlo automáticamente en .env si ya existe
    const envPath = path.resolve(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
        envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*/g, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      } else {
        envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
      }
      fs.writeFileSync(envPath, envContent);
      console.log('💾 Refresh token guardado automáticamente en .env\n');
    }

    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 2000);

  } catch (err) {
    console.error('❌ Error al intercambiar código por tokens:', err.message);
    res.writeHead(500);
    res.end('Error al obtener tokens');
    server.close();
  }
});

server.listen(3000, () => {
  console.log('🌐 Servidor temporal escuchando en http://localhost:3000\n');
});