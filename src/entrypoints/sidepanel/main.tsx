import { createRoot } from 'react-dom/client';
import { App } from '@/components/App';
import '@/styles.css';

// The same page serves the side panel and the expanded full-tab view (?view=tab).
const wide = new URLSearchParams(location.search).get('view') === 'tab';
document.title = wide ? 'Resume Tailor' : 'Resume Tailor';

createRoot(document.getElementById('root')!).render(<App wide={wide} />);
