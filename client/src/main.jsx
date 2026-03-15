import { createRoot } from 'react-dom/client'
import {BrowserRouter} from 'react-router-dom'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import ShopContextProvider from './context/ShopContext.jsx'

axios.defaults.timeout = 15000;
axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

createRoot(document.getElementById('root')).render(
  
  <BrowserRouter>
  
   <ShopContextProvider>
    <App />
   </ShopContextProvider>
    
  </BrowserRouter>
    
  
)
