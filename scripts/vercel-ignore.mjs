import ignore from 'ignore';

// Match @vercel/client 18.8.2 getVercelIgnore (Vercel CLI 63.1.2), using its
// exact ignore@4.0.6 parser. Keep the defaults/version together when updating.
// https://github.com/vercel/vercel/blob/main/packages/client/src/utils/index.ts
// We need only filtering, not the deployment client's network/archive dependency tree.
export const vercelDefaultIgnores = [
  '.hg', '.git', '.gitmodules', '.svn', 'CVS', '.cache', '.next', '.now', '.vercel',
  '.npmignore', '.dockerignore', '.gitignore', '.*.swp', '.DS_Store', '.wafpicke-*',
  '.lock-wscript', '.env.local', '.env.*.local', '.venv', '.yarn/cache', '.pnp*',
  'npm-debug.log', 'config.gypi', 'node_modules', '__pycache__', 'venv',
];

export function vercelIgnore(rules, { rustRoot = false } = {}) {
  const defaults = rustRoot ? [...vercelDefaultIgnores, '/target'] : vercelDefaultIgnores;
  // This normalization is from Vercel; pattern parsing and parent/negation handling
  // belong entirely to the same upstream ignore library, not custom regular expressions.
  return ignore().add(`${defaults.join('\n')}\n${rules.replace(/(\n|^)\.\//g, '$1')}`);
}
