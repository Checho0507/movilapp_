const { spawn } = require('node:child_process');
const os = require('node:os');

function getLanHost() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      if (address.family !== 'IPv4' || address.internal) continue;
      candidates.push(address.address);
    }
  }

  return candidates.find((value) => !/^127\./.test(value)) || 'localhost';
}

const host = getLanHost();
const env = {
  ...process.env,
  EXPO_PUBLIC_DOMAIN: host,
  EXPO_PUBLIC_API_BASE_URL: `http://${host}:3000`,
  REACT_NATIVE_PACKAGER_HOSTNAME: host,
};

const child = spawn('pnpm', ['exec', 'expo', 'start', '--host', 'lan', '--port', '19000'], {
  stdio: 'inherit',
  env,
  shell: false,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to start Expo dev server:', error);
  process.exit(1);
});
