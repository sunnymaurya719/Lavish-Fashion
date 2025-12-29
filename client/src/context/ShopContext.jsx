import { createContext, useEffect } from "react";
import { useState } from "react";
import { products } from "../assets/assets";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import axios from 'axios';

export const ShopContext= createContext();


const ShopContextProvider = (props) =>{

    const currency = '₹';
    const delivery_fee = 10;
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
    const [search,setSearch] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [cartItems, setCartItems] = useState({});
    const [products,setProducts] = useState([]);
    const [loadingProductsData,setLoadingProductsData] = useState(false);
    const [token,setToken] = useState(localStorage.getItem('token') || null);
    const navigate = useNavigate();

    const addToCart = async(itemId,size) => {
        

        if(!size) {
            toast.error('Please select a size');
            return;
        }

        let cartData = structuredClone(cartItems);

        if(cartData[itemId]) {
            if(cartData[itemId][size]){
                cartData[itemId][size] += 1;
            }
            else {
                cartData[itemId][size] = 1;
            }

        }
        else{
            cartData[itemId] = {};
            cartData[itemId][size] = 1;
        }

        setCartItems(cartData);

        if(token){
            try{
                await axios.post(BACKEND_URL + '/api/cart/add',{itemId,size},{headers:{token}})
            }
            catch(error){
                console.error("Error updating cart on server:", error);
            }
        }
    }

    const getCartCount = () =>{
        let totalCount = 0;
        for(const items in cartItems) {
            for(const item in cartItems[items]) {
                try {
                    if(cartItems[items][item] > 0){
                        totalCount += cartItems[items][item];

                    }
                }catch (error) {

                }
                
            }
        }
        return totalCount;
    }

    const updateQuantity = async(itemId,size,quantity) =>{
        let cartData = structuredClone(cartItems);
        cartData[itemId][size] = quantity;
        setCartItems(cartData);

        if(token){  
            try{
                await axios.post(BACKEND_URL + '/api/cart/update',{itemId,size,quantity},{headers:{token}})
            }
            catch(error){
                console.log("Error updating cart on server:", error);
                toast.error(error.message);
            }
        }
    }

    const getCartAmount =() =>{

        let totalAmount = 0;
        for(const items in cartItems){
            let itemInfo = products.find((product)=> product._id === items);
            for(const item in cartItems[items]){
                try{
                    if(cartItems[items][item] > 0){
                        totalAmount += itemInfo.price * cartItems[items][item];
                    }
                }
                catch(error){
                    console.error(`Error calculating total amount for item ${items} with size ${item}:`, error);
                    toast.error('An error occurred while calculating the total amount.');
                    return 0; // Return 0 or handle the error as needed
                }
            }
        }
        return totalAmount;

    }

    const getProductsData = async() =>{
        setLoadingProductsData(true);
        try{
            const response = await axios.get(BACKEND_URL + '/api/product/list');
            if(response.data.success){
                setProducts(response.data.products);
                setLoadingProductsData(false);
            }
            else{
                toast.error(response.data.message);
            }
        }
        catch(error){
            console.error("Error fetching products data:", error);
            toast.error("Failed to fetch products data.");
        }
    }

    const getUserCart = async(token) =>{
        try{
            console.log("Fetching user cart data with token:", token);
            const response = await axios.post(BACKEND_URL + '/api/cart/get',{},{headers:{token}});
            if(response.data.success){
                console.log("User cart data fetched:", response.data.cartData);
                setCartItems(response.data.cartData);
            }
        }
        catch(error){
            console.error("Error fetching user cart data:", error);
            toast.error("Failed to fetch cart data.");
        }
    }

    useEffect(()=>{
        getProductsData();
    },[])

    useEffect(() => {
        if(!token && localStorage.getItem('token')){
            
            setToken(localStorage.getItem('token'));
            
            
        }
    },[]);

    useEffect(() =>{
        
            console.log("Token changed, fetching user cart data");
            getUserCart(localStorage.getItem('token'));
        
    },[]);

    const value ={
        products, currency, delivery_fee,
        search, setSearch,showSearch, setShowSearch,
        cartItems,addToCart,setCartItems,
        getCartCount,updateQuantity,
        getCartAmount,
        navigate,BACKEND_URL,
        setToken,token,toast,
        getUserCart,
        loadingProductsData
    }

    return(
        <ShopContext.Provider value={value}>
            {props.children}
        </ShopContext.Provider>
    )
}


export default ShopContextProvider;