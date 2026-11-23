import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKnowledgeBase } from './loader.js';
import { TfIdfRetriever } from './retriever.js';

export * from './loader.js';
export * from './retriever.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Works from both src/ (tsx) and dist/ (compiled): both sit two levels below backend/. */
export const DEFAULT_KB_DIR = path.resolve(here, '../../..', 'knowledge-base');

export function createRetriever(directory = DEFAULT_KB_DIR): TfIdfRetriever {
  return new TfIdfRetriever(loadKnowledgeBase(directory));
}
