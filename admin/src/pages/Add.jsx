import React from 'react';
import ProductForm from '../components/ProductForm';

const Add = ({ token, serverBootstrap, serverStatus }) => {
  return <ProductForm token={token} mode='create' serverBootstrap={serverBootstrap} serverStatus={serverStatus} />;
};

export default Add;
