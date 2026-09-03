'use strict';

const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read(fallback) {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.backupCorruptFile();
      }
      return fallback;
    }
  }

  write(value) {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }

  backupCorruptFile() {
    try {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      fs.renameSync(this.filePath, backup);
    } catch {
      // If recovery itself fails, defaults are still safer than blocking launch.
    }
  }
}

module.exports = { JsonStore };
