const fs = require('fs');
const crypto = require('crypto');

let s = fs.readFileSync('.env.example', 'utf8');

const set = (key, value) => {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}="${value}"`;
  if (re.test(s)) s = s.replace(re, line);
  else s += `\n${line}\n`;
};

// Local PGLite server started by `npm run db:start` (127.0.0.1:5433).
set('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:5433/postgres');
// The app is being served on 3050 in this session.
set('NEXTAUTH_URL', 'http://localhost:3050');
set('NEXT_PUBLIC_APP_URL', 'http://localhost:3050');
set('NEXTAUTH_SECRET', crypto.randomBytes(32).toString('base64'));
set('API_KEY_ENCRYPTION_KEY', crypto.randomBytes(32).toString('hex'));

fs.writeFileSync('.env', s);
console.log('apps/web/.env written for local PGLite on 127.0.0.1:5433, app URL :3050');
