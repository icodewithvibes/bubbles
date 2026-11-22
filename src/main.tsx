import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/legacy.css'
import './styles/whatsnew.css'
import './styles/themes.css'
import './styles/effects.css'
import './styles/media.css'
import './styles/stickers.css'
import './styles/search.css'
import './index.css'
import App from './App'
import { boot } from './services/session'

boot()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
