/*
    Interpify - Real-time voice translation platform
    Copyright (C) 2024  Joshua Covelli (absolem)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

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