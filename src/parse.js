'use strict';

const { SharedNodeEnvError } = require('./errors');

function parseEnvData(text, filePath) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new SharedNodeEnvError(
      'ERR_FILE_EMPTY',
      `Environment file is empty: ${filePath}`,
      { path: filePath }
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new SharedNodeEnvError(
      'ERR_FILE_MALFORMED',
      `Environment file is not valid JSON: ${filePath}`,
      { path: filePath, cause }
    );
  }

  if (!Array.isArray(data)) {
    throw new SharedNodeEnvError(
      'ERR_FILE_MALFORMED',
      `Environment file must contain a JSON array of {key, value} objects: ${filePath}`,
      { path: filePath }
    );
  }

  return data.map((entry, index) => toPair(entry, index, filePath));
}

function toPair(entry, index, filePath) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new SharedNodeEnvError(
      'ERR_ENTRY_INVALID',
      `Entry at index ${index} must be an object: ${filePath}`,
      { path: filePath }
    );
  }

  const { key, value } = entry;

  if (typeof key !== 'string' || key.trim() === '') {
    throw new SharedNodeEnvError(
      'ERR_ENTRY_INVALID',
      `Entry at index ${index} has a missing or empty "key": ${filePath}`,
      { path: filePath }
    );
  }

  const type = typeof value;
  if (type !== 'string' && type !== 'number' && type !== 'boolean') {
    throw new SharedNodeEnvError(
      'ERR_ENTRY_INVALID',
      `Entry "${key}" at index ${index} must have a string, number, or boolean "value": ${filePath}`,
      { path: filePath }
    );
  }

  return { key, value: String(value) };
}

module.exports = { parseEnvData };
