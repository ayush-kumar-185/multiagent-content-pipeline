import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { Topic, TopicSchema } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TOPICS_DIR = path.resolve(__dirname, '../topics');

/**
 * Loads and validates a single topic YAML file.
 */
export async function loadTopicFile(filePath: string): Promise<Topic> {
  const content = await fs.readFile(filePath, 'utf-8');
  const raw = YAML.parse(content);
  return TopicSchema.parse(raw);
}

/**
 * Loads all topic YAML files in the given directory.
 */
export async function loadAllTopics(topicsDir: string = DEFAULT_TOPICS_DIR): Promise<Topic[]> {
  const entries = await fs.readdir(topicsDir);
  const yamlFiles = entries.filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'));

  const topics: Topic[] = [];
  for (const file of yamlFiles) {
    const fullPath = path.join(topicsDir, file);
    const topic = await loadTopicFile(fullPath);
    topics.push(topic);
  }

  // Sort deterministically by topic id
  return topics.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Loads a topic by its unique ID.
 */
export async function loadTopicById(
  topicId: string,
  topicsDir: string = DEFAULT_TOPICS_DIR,
): Promise<Topic> {
  const topics = await loadAllTopics(topicsDir);
  const matched = topics.find((t) => t.id === topicId);
  if (!matched) {
    throw new Error(`Topic with id '${topicId}' not found in ${topicsDir}`);
  }
  return matched;
}
