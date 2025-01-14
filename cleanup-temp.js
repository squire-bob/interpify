import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, 'temp');
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

function cleanupOldFiles() {
  if (!fs.existsSync(TEMP_DIR)) {
    console.log('Temp directory does not exist. Creating...');
    fs.mkdirSync(TEMP_DIR);
    return;
  }

  const now = Date.now();
  const files = fs.readdirSync(TEMP_DIR);

  files.forEach(file => {
    const filePath = path.join(TEMP_DIR, file);
    const stats = fs.statSync(filePath);
    const age = now - stats.mtimeMs;

    if (age > MAX_AGE) {
      try {
        fs.unlinkSync(filePath);
        console.log(`Deleted old file: ${file}`);
      } catch (err) {
        console.error(`Error deleting file ${file}:`, err);
      }
    }
  });
}

// Run cleanup
cleanupOldFiles();

// If running as a scheduled task, you can also export the function
export { cleanupOldFiles }; 