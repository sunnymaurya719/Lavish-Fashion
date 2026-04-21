import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import {BrowserRouter} from 'react-router-dom'
import { AuthProvider } from './store/authStore'

axios.defaults.timeout = 15000;
axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>, 
)
