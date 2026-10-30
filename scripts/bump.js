import fs from 'node:fs';

const type = process.argv[2] || 'patch'; // 'patch', 'minor', 'major', or explicit version '0.1.2'

// 1. Read current version from package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
let [major, minor, patch] = pkg.version.split('.').map(Number);

if (type === 'major') {
  major++;
  minor = 0;
  patch = 0;
} else if (type === 'minor') {
  minor++;
  patch = 0;
} else if (type === 'patch') {
  patch++;
} else if (/^\d+\.\d+\.\d+$/.test(type)) {
  [major, minor, patch] = type.split('.').map(Number);
} else {
  console.error(`Invalid version bump argument: "${type}". Use 'patch', 'minor', 'major', or 'X.Y.Z'.`);
  process.exit(1);
}

const newVersion = `${major}.${minor}.${patch}`;
console.log(`Bumping version: ${pkg.version} -> ${newVersion}`);

// 2. Update package.json
pkg.version = newVersion;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// 3. Update src-tauri/tauri.conf.json
const tauriConf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
tauriConf.version = newVersion;
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConf, null, 2) + '\n');

// 4. Update src-tauri/Cargo.toml
let cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
cargo = cargo.replace(/^version = ".*"/m, `version = "${newVersion}"`);
fs.writeFileSync('src-tauri/Cargo.toml', cargo);

console.log(`Updated package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml to v${newVersion}`);
