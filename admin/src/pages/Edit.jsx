import React from 'react';
import { useParams } from 'react-router-dom';
import ProductForm from '../components/ProductForm';

const Edit = ({ token, serverBootstrap, serverStatus }) => {
  const { productId } = useParams();

  return (
    <ProductForm
      token={token}
      mode='edit'
      productId={productId}
      serverBootstrap={serverBootstrap}
      serverStatus={serverStatus}
    />
  );
};

export default Edit;
