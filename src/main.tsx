import { createRoot } from 'react-dom/client';
import App from './app/App';
import { loadSettings, darkTheme, darkPdfTheme } from './features/settings/preferences';
const initialSettings = loadSettings();
document.documentElement.dataset.theme = darkTheme(initialSettings) ? 'dark' : 'light';
document.documentElement.dataset.pdfTheme = darkPdfTheme(initialSettings) ? 'dark' : 'light';
import './shared/styles/app.css';

performance.mark('elastic:bootstrap');
createRoot(document.getElementById('root')!).render(<App />);
