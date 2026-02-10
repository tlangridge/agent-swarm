import { execSync, spawn } from 'child_process';

const IMAGE_NAME = 'agent-swarm-sandbox:latest';

let _dockerAvailable = false;
let _imageExists = false;

export function isDockerAvailable(): boolean {
  return _dockerAvailable;
}

export function isImageBuilt(): boolean {
  return _imageExists;
}

export async function detectDocker(): Promise<void> {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5000 });
    _dockerAvailable = true;
    console.log('Docker detected and running');
  } catch {
    _dockerAvailable = false;
    console.log('Docker not available — Docker mode disabled');
    return;
  }

  // Check if our sandbox image exists
  try {
    execSync(`docker image inspect ${IMAGE_NAME}`, { stdio: 'ignore', timeout: 5000 });
    _imageExists = true;
    console.log(`Docker image ${IMAGE_NAME} found`);
  } catch {
    _imageExists = false;
    console.log(`Docker image ${IMAGE_NAME} not found — run POST /api/docker/build or: docker build -t ${IMAGE_NAME} docker/`);
  }
}

export function buildImage(onLog: (data: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['build', '-t', IMAGE_NAME, 'docker/'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (chunk: Buffer) => onLog(chunk.toString()));
    proc.stderr.on('data', (chunk: Buffer) => onLog(chunk.toString()));

    proc.on('close', (code) => {
      if (code === 0) {
        _imageExists = true;
        onLog('Build complete.\n');
        resolve(true);
      } else {
        onLog(`Build failed with exit code ${code}\n`);
        resolve(false);
      }
    });

    proc.on('error', (err) => {
      onLog(`Build error: ${err.message}\n`);
      resolve(false);
    });
  });
}
