import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VisorHudPage from './components/VisorHudPage.jsx'

const mode = new URLSearchParams(window.location.search).get('mode')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {mode === 'visor' || mode === 'visor-ar' ? <VisorHudPage /> : <App />}
  </StrictMode>,
)
