import { createRoot } from 'react-dom/client';
import './pwaRegister';
import './index.css';
import App from './App';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
