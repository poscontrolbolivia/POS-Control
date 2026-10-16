import { createRoot } from 'react-dom/client'
import { StoreProvider } from './services/store.jsx'
import { IdiomaProvider } from './i18n/index.jsx'
import App from './App.jsx'
import PwaBridge from './components/pwa/PwaBridge.jsx'
import './styles.css'
createRoot(document.getElementById('root')).render(
  // IdiomaProvider por fuera de todo: LoginPage, Topbar, App y PwaBridge leen useIdioma().
  <IdiomaProvider>
    <StoreProvider>
      <App />
      <PwaBridge />
    </StoreProvider>
  </IdiomaProvider>
)
