import { spawnSync } from 'node:child_process';

const bumpType = process.argv[2] || 'patch';

// 1. Run bump with whatever argument was passed (patch, minor, major, or X.Y.Z)
const bump = spawnSync('node', ['scripts/bump.js', bumpType], { stdio: 'inherit', shell: true });
if (bump.status !== 0) {
  process.exit(bump.status || 1);
}

// 2. Run tauri build (or npm run tauri build)
const build = spawnSync('npm', ['run', 'tauri', 'build'], { stdio: 'inherit', shell: true });
process.exit(build.status || 0);
