import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/montserrat/300.css'
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/600.css'
import App from './App'
import { applyTheme, loadTheme } from './eclipse/theme'
import './styles.css'

applyTheme(loadTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
