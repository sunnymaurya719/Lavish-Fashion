import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import userModel from '../models/userModel.js';
import { determineLoyaltyTier } from '../services/loyaltyService.js';

const buildCustomerOrderMetrics = (orders = []) => {
    const paidOrders = orders.filter((order) => order.payment);

    return {
        ordersCount: orders.length,
        paidOrdersCount: paidOrders.length,
        totalSpent: paidOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0),
        lastOrderDate: orders.length > 0 ? Math.max(...orders.map((order) => Number(order.date || 0))) : null
    };
};

const listCustomers = async (req, res) => {
    try {
        const [customers, orders] = await Promise.all([
            userModel.find({}).sort({ createdAt: -1 }).lean(),
            orderModel.find({}).lean()
        ]);

        const ordersByUserId = orders.reduce((map, order) => {
            const userOrders = map.get(order.userId) || [];
            userOrders.push(order);
            map.set(order.userId, userOrders);
            return map;
        }, new Map());

        return res.status(200).json({
            success: true,
            customers: customers.map((customer) => {
                const customerOrders = ordersByUserId.get(String(customer._id)) || [];
                const metrics = buildCustomerOrderMetrics(customerOrders);

                return {
                    _id: String(customer._id),
                    name: customer.name,
                    email: customer.email,
                    phone: customer.phone || '',
                    adminNotes: customer.adminNotes || '',
                    referralCode: customer.referralCode || '',
                    successfulReferralCount: Number(customer.successfulReferralCount || 0),
                    loyaltyPoints: Number(customer.loyaltyPoints || 0),
                    loyaltyTier: determineLoyaltyTier(customer.lifetimeLoyaltyPoints || customer.loyaltyPoints || 0).currentTier,
                    wishlistCount: Array.isArray(customer.wishlist) ? customer.wishlist.length : 0,
                    createdAt: customer.createdAt || null,
                    ...metrics
                };
            })
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch customers');
        return res.status(500).json({ success: false, message: 'Failed to fetch customers' });
    }
};

const getCustomerDetail = async (req, res) => {
    try {
        const { customerId } = req.body;
        const customer = await userModel.findById(customerId).lean();

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const customerOrders = await orderModel.find({ userId: customerId }).sort({ date: -1 }).lean();
        const wishlistProducts = Array.isArray(customer.wishlist) && customer.wishlist.length > 0
            ? await productModel.find({ _id: { $in: customer.wishlist } }).lean()
            : [];

        const metrics = buildCustomerOrderMetrics(customerOrders);

        return res.status(200).json({
            success: true,
            customer: {
                _id: String(customer._id),
                name: customer.name,
                email: customer.email,
                phone: customer.phone || '',
                adminNotes: customer.adminNotes || '',
                referralCode: customer.referralCode || '',
                successfulReferralCount: Number(customer.successfulReferralCount || 0),
                loyaltyPoints: Number(customer.loyaltyPoints || 0),
                lifetimeLoyaltyPoints: Number(customer.lifetimeLoyaltyPoints || 0),
                loyaltyTier: determineLoyaltyTier(customer.lifetimeLoyaltyPoints || customer.loyaltyPoints || 0).currentTier,
                wishlistCount: Array.isArray(customer.wishlist) ? customer.wishlist.length : 0,
                createdAt: customer.createdAt || null,
                ...metrics
            },
            recentOrders: customerOrders.slice(0, 8),
            wishlistProducts: wishlistProducts.map((product) => ({
                _id: String(product._id),
                name: product.name,
                image: product.image,
                category: product.category,
                subCategory: product.subCategory,
                price: product.price,
                status: product.status,
                stock: product.stock
            }))
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch customer detail');
        return res.status(500).json({ success: false, message: 'Failed to fetch customer detail' });
    }
};

const updateCustomerNotes = async (req, res) => {
    try {
        const { customerId, adminNotes } = req.body;
        const updatedCustomer = await userModel.findByIdAndUpdate(
            customerId,
            { adminNotes },
            { new: true, runValidators: true }
        ).lean();

        if (!updatedCustomer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Customer notes updated successfully',
            customer: {
                _id: String(updatedCustomer._id),
                adminNotes: updatedCustomer.adminNotes || ''
            }
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to update customer notes');
        return res.status(500).json({ success: false, message: 'Failed to update customer notes' });
    }
};

export { getCustomerDetail, listCustomers, updateCustomerNotes };
