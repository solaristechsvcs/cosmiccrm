import { pathToFileURL } from 'node:url';
import path from 'node:path';
export async function loadConfig() {
  let config;
  try { config = (await import(pathToFileURL(path.resolve('config.js')).href)).default; }
  catch (error) { throw new Error('Cannot load config.js. Copy config.example.js to config.js and configure it.', { cause: error }); }
  if (!config?.database?.database || !config.database.user) throw new Error('Configure database credentials in config.js.');
  if (!config.sessionSecret || config.sessionSecret.length < 48 || config.sessionSecret.includes('REPLACE_')) throw new Error('sessionSecret must be a unique random string of at least 48 characters.');
  const url = new URL(config.publicUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('publicUrl must be an HTTP(S) URL.');
  return { ...config, publicUrl: url.origin };
}
