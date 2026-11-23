import fs from 'node:fs';
import path from 'node:path';

export interface KnowledgeChunk {
  /** Stable citation id, e.g. "priority-levels#medium-versus-high". */
  id: string;
  docId: string;
  docTitle: string;
  section: string;
  text: string;
  tags: string[];
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  tags: string[];
  chunks: KnowledgeChunk[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/**
 * Parses markdown docs with a tiny front-matter block:
 *   ---
 *   id: priority-levels
 *   title: Priority levels
 *   tags: a, b, c
 *   ---
 * Each "## " section becomes its own retrievable chunk (text before the first section becomes an
 * "Overview" chunk). Section-level chunks give precise citations and keep the context sent to the
 * LLM small, which reduces the chance it latches onto irrelevant text.
 */
export function parseKnowledgeDocument(raw: string, fallbackId: string): KnowledgeDocument {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  let body = raw;
  if (match) {
    for (const line of match[1]!.split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    body = match[2]!;
  }

  const id = meta.id || fallbackId;
  const title = meta.title || id;
  const tags = (meta.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);

  const chunks: KnowledgeChunk[] = [];
  let section = 'Overview';
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (text) chunks.push({ id: `${id}#${slug(section)}`, docId: id, docTitle: title, section, text, tags });
    buffer = [];
  };

  for (const line of body.split('\n')) {
    if (line.startsWith('# ')) continue; // document title, already in metadata
    if (line.startsWith('## ')) {
      flush();
      section = line.slice(3).trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return { id, title, tags, chunks };
}

export function loadKnowledgeBase(directory: string): KnowledgeDocument[] {
  const files = fs.readdirSync(directory).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) throw new Error(`Knowledge base directory has no .md files: ${directory}`);
  return files.map((file) =>
    parseKnowledgeDocument(fs.readFileSync(path.join(directory, file), 'utf8'), path.basename(file, '.md')),
  );
}
