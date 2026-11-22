import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/legacy.css'
import './styles/whatsnew.css'
import './styles/themes.css'
import './index.css'
import App from './App'
import { boot } from './services/session'

boot()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
