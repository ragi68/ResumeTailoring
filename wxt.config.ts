import { defineConfig } from 'wxt';
import { ATS_HOST_PATTERNS } from './src/lib/hosts';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'Resume Tailor',
    description: 'Tailor your master resume to a job description and attach it to the application upload.',
    permissions: ['sidePanel', 'storage', 'scripting', 'activeTab'],
    host_permissions: [
      ...ATS_HOST_PATTERNS,
      'https://api.anthropic.com/*',
      // The e2e build pre-grants localhost so tests never hit the permission prompt.
      ...(mode === 'e2e' ? ['http://localhost/*'] : []),
    ],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'Open Resume Tailor' },
  }),
});
