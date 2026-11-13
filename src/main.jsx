import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VisorHudPage from './components/VisorHudPage.jsx'

const isVisorMode = new URLSearchParams(window.location.search).get('mode') === 'visor'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isVisorMode ? <VisorHudPage /> : <App />}
  </StrictMode>,
)
