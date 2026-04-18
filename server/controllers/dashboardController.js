import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import userModel from '../models/userModel.js';
import { backfillMissingProductInventory } from '../services/productInventoryService.js';

const currency = 'INR';
const orderStatuses = ['Order Placed', 'Packing', 'Shipped', 'Out for delivery', 'Delivered'];
const paymentMethods = ['COD', 'Stripe', 'Razorpay'];
const productStatuses = ['active', 'draft', 'archived'];
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

const getDashboardMetrics = async (req, res) => {
    try {
        await backfillMissingProductInventory();

        const now = new Date();
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        const sevenDaysAgoTimestamp = sevenDaysAgo.getTime();

        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const [
            orderTotals,
            orderStatusBreakdown,
            orderPaymentMethodBreakdown,
            revenueSeriesRaw,
            topProducts,
            recentOrders,
            productCatalogStats,
            lowStockProducts,
            customerTotals,
            recentCustomers
        ] = await Promise.all([
            // 1. Order totals (revenue, paid, pending, delivered counts)
            orderModel.aggregate([
                {
                    $group: {
                        _id: null,
                        totalOrders: { $sum: 1 },
                        totalRevenue: { $sum: { $cond: ['$payment', { $ifNull: ['$amount', 0] }, 0] } },
                        paidOrders: { $sum: { $cond: ['$payment', 1, 0] } },
                        pendingOrders: { $sum: { $cond: [{ $ne: ['$status', 'Delivered'] }, 1, 0] } },
                        deliveredOrders: { $sum: { $cond: [{ $eq: ['$status', 'Delivered'] }, 1, 0] } }
                    }
                }
            ]),

            // 2. Order status breakdown
            orderModel.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),

            // 3. Payment method breakdown
            orderModel.aggregate([
                { $group: { _id: '$paymentMethod', count: { $sum: 1 } } }
            ]),

            // 4. Revenue series (last 7 days)
            orderModel.aggregate([
                { $match: { date: { $gte: sevenDaysAgoTimestamp } } },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$date' } }
                        },
                        revenue: { $sum: { $cond: ['$payment', { $ifNull: ['$amount', 0] }, 0] } },
                        orders: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),

            // 5. Top products by quantity sold
            orderModel.aggregate([
                { $unwind: '$items' },
                {
                    $group: {
                        _id: '$items._id',
                        name: { $first: '$items.name' },
                        quantitySold: { $sum: '$items.quantity' },
                        revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
                    }
                },
                { $sort: { quantitySold: -1 } },
                { $limit: 6 },
                { $project: { productId: '$_id', name: 1, quantitySold: 1, revenue: 1, _id: 0 } }
            ]),

            // 6. Recent orders (last 6)
            orderModel.aggregate([
                { $sort: { date: -1 } },
                { $limit: 6 },
                {
                    $project: {
                        orderId: { $toString: '$_id' },
                        customerName: {
                            $trim: {
                                input: {
                                    $concat: [
                                        { $ifNull: ['$address.firstName', ''] },
                                        ' ',
                                        { $ifNull: ['$address.lastName', ''] }
                                    ]
                                }
                            }
                        },
                        amount: { $ifNull: ['$amount', 0] },
                        status: 1,
                        paymentMethod: 1,
                        payment: 1,
                        itemCount: { $size: { $ifNull: ['$items', []] } },
                        date: 1,
                        _id: 0
                    }
                }
            ]),

            // 7. Product catalog stats (status counts, inventory, featured)
            productModel.aggregate([
                {
                    $group: {
                        _id: null,
                        totalProducts: { $sum: 1 },
                        activeProducts: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
                        draftProducts: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
                        archivedProducts: { $sum: { $cond: [{ $eq: ['$status', 'archived'] }, 1, 0] } },
                        featuredProducts: { $sum: { $cond: ['$isFeatured', 1, 0] } },
                        totalInventoryUnits: { $sum: { $ifNull: ['$stock', 0] } },
                        outOfStock: {
                            $sum: { $cond: [{ $and: [{ $ne: ['$status', 'archived'] }, { $eq: [{ $ifNull: ['$stock', 0] }, 0] }] }, 1, 0] }
                        },
                        lowStock: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $ne: ['$status', 'archived'] },
                                            { $gt: [{ $ifNull: ['$stock', 0] }, 0] },
                                            { $lte: [{ $ifNull: ['$stock', 0] }, { $ifNull: ['$lowStockThreshold', DEFAULT_LOW_STOCK_THRESHOLD] }] }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]),

            // 8. Low stock products (for table display)
            productModel.aggregate([
                { $match: { status: { $ne: 'archived' } } },
                {
                    $addFields: {
                        effectiveThreshold: { $ifNull: ['$lowStockThreshold', DEFAULT_LOW_STOCK_THRESHOLD] }
                    }
                },
                {
                    $match: {
                        $expr: { $lte: [{ $ifNull: ['$stock', 0] }, '$effectiveThreshold'] }
                    }
                },
                { $sort: { stock: 1 } },
                { $limit: 6 },
                {
                    $project: {
                        id: { $toString: '$_id' },
                        name: 1,
                        sku: 1,
                        category: 1,
                        stock: 1,
                        lowStockThreshold: '$effectiveThreshold',
                        status: 1,
                        _id: 0
                    }
                }
            ]),

            // 9. Customer totals
            userModel.aggregate([
                {
                    $group: {
                        _id: null,
                        totalCustomers: { $sum: 1 },
                        newCustomersLast30Days: {
                            $sum: { $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, 1, 0] }
                        }
                    }
                }
            ]),

            // 10. Recent customers with order performance
            userModel.aggregate([
                { $sort: { createdAt: -1 } },
                { $limit: 6 },
                {
                    $lookup: {
                        from: 'orders',
                        let: { uid: { $toString: '$_id' } },
                        pipeline: [
                            { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
                            {
                                $group: {
                                    _id: null,
                                    orderCount: { $sum: 1 },
                                    paidOrders: { $sum: { $cond: ['$payment', 1, 0] } },
                                    totalSpent: { $sum: { $cond: ['$payment', { $ifNull: ['$amount', 0] }, 0] } }
                                }
                            }
                        ],
                        as: 'orderStats'
                    }
                },
                {
                    $project: {
                        id: { $toString: '$_id' },
                        name: 1,
                        email: 1,
                        phone: { $ifNull: ['$phone', ''] },
                        joinedAt: '$createdAt',
                        orderCount: { $ifNull: [{ $arrayElemAt: ['$orderStats.orderCount', 0] }, 0] },
                        paidOrders: { $ifNull: [{ $arrayElemAt: ['$orderStats.paidOrders', 0] }, 0] },
                        totalSpent: { $ifNull: [{ $arrayElemAt: ['$orderStats.totalSpent', 0] }, 0] },
                        _id: 0
                    }
                }
            ])
        ]);

        // Process aggregation results
        const totalsRow = orderTotals[0] || { totalOrders: 0, totalRevenue: 0, paidOrders: 0, pendingOrders: 0, deliveredOrders: 0 };
        const productStats = productCatalogStats[0] || {
            totalProducts: 0, activeProducts: 0, draftProducts: 0, archivedProducts: 0,
            featuredProducts: 0, totalInventoryUnits: 0, outOfStock: 0, lowStock: 0
        };
        const customerStats = customerTotals[0] || { totalCustomers: 0, newCustomersLast30Days: 0 };

        // Build revenue series with backfill for missing days
        const revenueSeriesMap = new Map(revenueSeriesRaw.map((item) => [item._id, item]));
        const revenueSeriesSeed = [];
        for (let index = 6; index >= 0; index -= 1) {
            const date = new Date(now);
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - index);
            const key = date.toISOString().slice(0, 10);
            const bucket = revenueSeriesMap.get(key);
            revenueSeriesSeed.push({
                key,
                label: date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
                revenue: bucket ? bucket.revenue : 0,
                orders: bucket ? bucket.orders : 0
            });
        }

        // Normalize status/payment breakdowns to expected format
        const statusBreakdownMap = new Map(orderStatuses.map((status) => [status, 0]));
        orderStatusBreakdown.forEach((row) => {
            const key = orderStatuses.includes(row._id) ? row._id : String(row._id || 'Unknown');
            statusBreakdownMap.set(key, (statusBreakdownMap.get(key) || 0) + row.count);
        });

        const paymentMethodBreakdownMap = new Map(paymentMethods.map((method) => [method, 0]));
        orderPaymentMethodBreakdown.forEach((row) => {
            const key = paymentMethods.includes(row._id) ? row._id : String(row._id || 'Unknown');
            paymentMethodBreakdownMap.set(key, (paymentMethodBreakdownMap.get(key) || 0) + row.count);
        });

        const healthyCount = productStats.totalProducts - productStats.archivedProducts - productStats.lowStock - productStats.outOfStock;

        res.set('Cache-Control', 'private, no-store, max-age=0');
        return res.status(200).json({
            success: true,
            metrics: {
                currency,
                totals: {
                    revenue: totalsRow.totalRevenue,
                    orders: totalsRow.totalOrders,
                    paidOrders: totalsRow.paidOrders,
                    pendingOrders: totalsRow.pendingOrders,
                    deliveredOrders: totalsRow.deliveredOrders,
                    products: productStats.totalProducts,
                    activeProducts: productStats.activeProducts,
                    featuredProducts: productStats.featuredProducts,
                    customers: customerStats.totalCustomers,
                    newCustomersLast30Days: customerStats.newCustomersLast30Days,
                    inventoryUnits: productStats.totalInventoryUnits,
                    lowStockProducts: lowStockProducts.length,
                    averageOrderValue: totalsRow.paidOrders > 0 ? totalsRow.totalRevenue / totalsRow.paidOrders : 0
                },
                revenueSeries: revenueSeriesSeed,
                statusBreakdown: Array.from(statusBreakdownMap.entries()).map(([status, count]) => ({ status, count })),
                paymentMethodBreakdown: Array.from(paymentMethodBreakdownMap.entries()).map(([method, count]) => ({
                    method,
                    count
                })),
                topProducts,
                lowStockProducts,
                recentOrders,
                recentCustomers,
                inventoryHealth: {
                    healthy: Math.max(0, healthyCount),
                    lowStock: productStats.lowStock,
                    outOfStock: productStats.outOfStock
                },
                catalogStatusBreakdown: productStatuses.map((status) => ({
                    status,
                    count: status === 'active' ? productStats.activeProducts
                        : status === 'draft' ? productStats.draftProducts
                        : productStats.archivedProducts
                }))
            }
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch dashboard metrics');
        return res.status(500).json({ success: false, message: 'Failed to fetch dashboard metrics' });
    }
};

export { getDashboardMetrics };
