import { createRoot } from 'react-dom/client';
import App from './app/App';
import { loadSettings, darkTheme } from './features/settings/preferences';
document.documentElement.dataset.theme = darkTheme(loadSettings()) ? 'dark' : 'light';
import './shared/styles/app.css';

performance.mark('elastic:bootstrap');
createRoot(document.getElementById('root')!).render(<App />);
