import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/register.all';
import 'monaco-editor/languages/features/register.all';
import { monacoWorkerSources } from './.editor-build/monaco-workers-inline.js';

const workerUrls = new Map();
function createMonacoWorker(_moduleId, label) {
  // Monaco routes JavaScript to TypeScript; related language IDs share workers.
  const aliases = { javascript: 'typescript', scss: 'css', less: 'css', handlebars: 'html', razor: 'html' };
  const normalizedLabel = aliases[label] || label;
  const key = ['json', 'css', 'html', 'typescript'].includes(normalizedLabel) ? normalizedLabel : 'editor';
  const source = monacoWorkerSources[key] || monacoWorkerSources.editor;
  let url = workerUrls.get(key);
  if (!url) {
    url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    workerUrls.set(key, url);
  }
  const worker = new Worker(url, { name: `n1pilot-monaco-${key}` });
  const terminate = worker.terminate.bind(worker);
  worker.terminate = () => {
    terminate();
    const activeUrl = workerUrls.get(key);
    if (activeUrl) URL.revokeObjectURL(activeUrl);
    workerUrls.delete(key);
  };
  return worker;
}

window.MonacoEnvironment = { getWorker: createMonacoWorker };
window.monaco = monaco;

try {
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    enableSchemaRequest: false,
    schemas: [],
    schemaValidation: 'error',
    comments: 'error',
    trailingCommas: 'error'
  });
} catch {}
