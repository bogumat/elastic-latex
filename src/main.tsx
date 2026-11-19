import { createRoot } from 'react-dom/client';
import App from './app/App';
import './shared/styles/app.css';

performance.mark('elastic:bootstrap');
createRoot(document.getElementById('root')!).render(<App />);
