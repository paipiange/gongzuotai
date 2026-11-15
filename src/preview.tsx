import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PaipiangeRoot } from './client/app/PaipiangeRoot'
import './client/styles.css'
import './preview.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Preview root element is missing')
}

createRoot(root).render(
  <StrictMode>
    <PaipiangeRoot />
  </StrictMode>,
)
