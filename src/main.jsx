import { createRoot } from 'react-dom/client'
import { StoreProvider } from './context/StoreContext.jsx'
import { IdiomaProvider } from './i18n/index.jsx'
import App from './App.jsx'
import PwaBridge from './components/PwaBridge.jsx'
import './styles/base.css'
import { aplicarTema, leerTema } from './services/theme.js'
aplicarTema(leerTema())
createRoot(document.getElementById('root')).render(

  <IdiomaProvider>
    <StoreProvider>
      <App />
      <PwaBridge />
    </StoreProvider>
  </IdiomaProvider>
)
