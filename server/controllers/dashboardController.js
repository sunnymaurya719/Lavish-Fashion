import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import userModel from '../models/userModel.js';
import { backfillMissingProductInventory, normalizeInventoryFields } from '../services/productInventoryService.js';

const currency = 'INR';
const orderStatuses = ['Order Placed', 'Packing', 'Shipped', 'Out for delivery', 'Delivered'];
const paymentMethods = ['COD', 'Stripe', 'Razorpay'];
const productStatuses = ['active', 'draft', 'archived'];
const formatDayKey = (date) => date.toISOString().slice(0, 10);

const getDashboardMetrics = async (req, res) => {
    try {
        await backfillMissingProductInventory();

        const [products, orders, customers] = await Promise.all([
            productModel.find({}).lean(),
            orderModel.find({}).lean(),
            userModel.find({}).lean()
        ]);

        const normalizedProducts = products.map(normalizeInventoryFields);
        const now = new Date();
        const revenueSeriesSeed = [];

        for (let index = 6; index >= 0; index -= 1) {
            const date = new Date(now);
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - index);

            revenueSeriesSeed.push({
                key: formatDayKey(date),
                label: date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
                revenue: 0,
                orders: 0
            });
        }

        const revenueSeriesMap = new Map(revenueSeriesSeed.map((item) => [item.key, item]));
        const totalRevenue = orders.reduce((sum, order) => sum + (order.payment ? Number(order.amount || 0) : 0), 0);
        const paidOrdersCount = orders.filter((order) => order.payment).length;
        const pendingOrdersCount = orders.filter((order) => order.status !== 'Delivered').length;
        const deliveredOrdersCount = orders.filter((order) => order.status === 'Delivered').length;

        orders.forEach((order) => {
            const bucket = revenueSeriesMap.get(formatDayKey(new Date(order.date)));

            if (!bucket) {
                return;
            }

            bucket.orders += 1;
            if (order.payment) {
                bucket.revenue += Number(order.amount || 0);
            }
        });

        const statusBreakdownMap = new Map(orderStatuses.map((status) => [status, 0]));
        const paymentMethodBreakdownMap = new Map(paymentMethods.map((method) => [method, 0]));
        const productPerformanceMap = new Map();
        const customerPerformanceMap = new Map();

        orders.forEach((order) => {
            const normalizedStatus = orderStatuses.includes(order.status) ? order.status : String(order.status || 'Unknown');
            const normalizedPaymentMethod = paymentMethods.includes(order.paymentMethod)
                ? order.paymentMethod
                : String(order.paymentMethod || 'Unknown');

            statusBreakdownMap.set(normalizedStatus, (statusBreakdownMap.get(normalizedStatus) || 0) + 1);
            paymentMethodBreakdownMap.set(
                normalizedPaymentMethod,
                (paymentMethodBreakdownMap.get(normalizedPaymentMethod) || 0) + 1
            );

            const customerPerformance = customerPerformanceMap.get(String(order.userId)) || {
                orderCount: 0,
                paidOrders: 0,
                totalSpent: 0
            };

            customerPerformance.orderCount += 1;
            if (order.payment) {
                customerPerformance.paidOrders += 1;
                customerPerformance.totalSpent += Number(order.amount || 0);
            }
            customerPerformanceMap.set(String(order.userId), customerPerformance);

            order.items.forEach((item) => {
                const existing = productPerformanceMap.get(item._id) || {
                    productId: item._id,
                    name: item.name,
                    quantitySold: 0,
                    revenue: 0
                };

                existing.quantitySold += Number(item.quantity || 0);
                existing.revenue += Number(item.quantity || 0) * Number(item.price || 0);
                productPerformanceMap.set(item._id, existing);
            });
        });

        const recentOrders = [...orders]
            .sort((left, right) => Number(right.date || 0) - Number(left.date || 0))
            .slice(0, 6)
            .map((order) => ({
                orderId: String(order._id),
                customerName: `${order.address?.firstName || ''} ${order.address?.lastName || ''}`.trim(),
                amount: Number(order.amount || 0),
                status: order.status,
                paymentMethod: order.paymentMethod,
                payment: Boolean(order.payment),
                itemCount: Array.isArray(order.items) ? order.items.length : 0,
                date: order.date
            }));

        const lowStockProducts = normalizedProducts
            .filter((product) => product.status !== 'archived' && product.stock <= product.lowStockThreshold)
            .sort((left, right) => left.stock - right.stock)
            .slice(0, 6)
            .map((product) => ({
                id: String(product._id),
                name: product.name,
                sku: product.sku,
                category: product.category,
                stock: product.stock,
                lowStockThreshold: product.lowStockThreshold,
                status: product.status
            }));

        const inventoryHealth = {
            healthy: normalizedProducts.filter((product) => product.inventoryState === 'healthy').length,
            lowStock: normalizedProducts.filter((product) => product.inventoryState === 'low_stock').length,
            outOfStock: normalizedProducts.filter((product) => product.inventoryState === 'out_of_stock').length
        };

        const catalogStatusBreakdown = productStatuses.map((status) => ({
            status,
            count: normalizedProducts.filter((product) => product.status === status).length
        }));

        const customersLast30Days = customers.filter((customer) => {
            if (!customer.createdAt) {
                return false;
            }

            const createdAt = new Date(customer.createdAt);
            const diffInMs = now.getTime() - createdAt.getTime();
            return diffInMs <= 30 * 24 * 60 * 60 * 1000;
        }).length;

        const recentCustomers = [...customers]
            .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
            .slice(0, 6)
            .map((customer) => {
                const performance = customerPerformanceMap.get(String(customer._id)) || {
                    orderCount: 0,
                    paidOrders: 0,
                    totalSpent: 0
                };

                return {
                    id: String(customer._id),
                    name: customer.name,
                    email: customer.email,
                    phone: customer.phone || '',
                    joinedAt: customer.createdAt || null,
                    orderCount: performance.orderCount,
                    paidOrders: performance.paidOrders,
                    totalSpent: performance.totalSpent
                };
            });

        return res.status(200).json({
            success: true,
            metrics: {
                currency,
                totals: {
                    revenue: totalRevenue,
                    orders: orders.length,
                    paidOrders: paidOrdersCount,
                    pendingOrders: pendingOrdersCount,
                    deliveredOrders: deliveredOrdersCount,
                    products: normalizedProducts.length,
                    activeProducts: normalizedProducts.filter((product) => product.status === 'active').length,
                    featuredProducts: normalizedProducts.filter((product) => product.isFeatured).length,
                    customers: customers.length,
                    newCustomersLast30Days: customersLast30Days,
                    inventoryUnits: normalizedProducts.reduce((sum, product) => sum + Number(product.stock || 0), 0),
                    lowStockProducts: lowStockProducts.length,
                    averageOrderValue: paidOrdersCount > 0 ? totalRevenue / paidOrdersCount : 0
                },
                revenueSeries: revenueSeriesSeed,
                statusBreakdown: Array.from(statusBreakdownMap.entries()).map(([status, count]) => ({ status, count })),
                paymentMethodBreakdown: Array.from(paymentMethodBreakdownMap.entries()).map(([method, count]) => ({
                    method,
                    count
                })),
                topProducts: Array.from(productPerformanceMap.values())
                    .sort((left, right) => right.quantitySold - left.quantitySold)
                    .slice(0, 6),
                lowStockProducts,
                recentOrders,
                recentCustomers,
                inventoryHealth,
                catalogStatusBreakdown
            }
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch dashboard metrics');
        return res.status(500).json({ success: false, message: 'Failed to fetch dashboard metrics' });
    }
};

export { getDashboardMetrics };
