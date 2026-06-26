// Tiny custom resolve hook for Node ESM : essaie d'ajouter .js si le
// specifier extensionless ne matche pas. Necessaire pour que les tests
// puissent importer src/services/qualityReducer.js qui contient des
// `import ... from '../constants/queue'` sans extension (style RN/Metro).

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:')) throw err;
    if (/\.[a-z]+$/.test(specifier)) throw err;
    const parentUrl = context.parentURL;
    if (!parentUrl) throw err;
    const parentPath = fileURLToPath(parentUrl);
    const base = new URL(specifier, pathToFileURL(parentPath));
    const candidate = `${base.href}.js`;
    const candidatePath = fileURLToPath(candidate);
    if (existsSync(candidatePath)) {
      return await nextResolve(candidate, context);
    }
    throw err;
  }
}
