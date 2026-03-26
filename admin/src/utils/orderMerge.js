const normalizeOrder = (order) => {
  if (!order) {
    return null;
  }

  return {
    ...order,
    _id: String(order._id || ''),
    date: Number(order.date || 0),
    items: Array.isArray(order.items) ? order.items : [],
  };
};

const sortOrdersByDateDesc = (orders) =>
  [...orders].sort((left, right) => Number(right?.date || 0) - Number(left?.date || 0));

const upsertOrderById = (orders, incomingOrder) => {
  const normalizedIncomingOrder = normalizeOrder(incomingOrder);

  if (!normalizedIncomingOrder?._id) {
    return orders;
  }

  const existingIndex = orders.findIndex((order) => String(order?._id || '') === normalizedIncomingOrder._id);

  if (existingIndex === -1) {
    return sortOrdersByDateDesc([...orders, normalizedIncomingOrder]);
  }

  const nextOrders = [...orders];
  nextOrders[existingIndex] = {
    ...nextOrders[existingIndex],
    ...normalizedIncomingOrder,
  };

  return sortOrdersByDateDesc(nextOrders);
};

const mergeOrderSnapshot = (orders = []) => sortOrdersByDateDesc(orders.map((order) => normalizeOrder(order)).filter(Boolean));

export { mergeOrderSnapshot, upsertOrderById };
