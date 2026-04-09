import productModel from '../models/productModel.js';

const DEFAULT_PRODUCT_STOCK = 25;
const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const PRODUCT_STATUS_VALUES = ['active', 'draft', 'archived'];

const backfillMissingProductInventory = async () => {
    await Promise.all([
        productModel.updateMany({ sku: { $exists: false } }, { $set: { sku: '' } }),
        productModel.updateMany({ stock: { $exists: false } }, { $set: { stock: DEFAULT_PRODUCT_STOCK } }),
        productModel.updateMany(
            { lowStockThreshold: { $exists: false } },
            { $set: { lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD } }
        ),
        productModel.updateMany({ status: { $exists: false } }, { $set: { status: 'active' } }),
        productModel.updateMany({ isFeatured: { $exists: false } }, { $set: { isFeatured: false } })
    ]);
};

const normalizeInventoryFields = (product) => {
    if (!product) {
        return null;
    }

    const normalized = typeof product.toObject === 'function' ? product.toObject() : { ...product };

    normalized.sku = String(normalized.sku || '').trim();
    normalized.stock = Number.isFinite(Number(normalized.stock)) ? Number(normalized.stock) : DEFAULT_PRODUCT_STOCK;
    normalized.lowStockThreshold = Number.isFinite(Number(normalized.lowStockThreshold))
        ? Number(normalized.lowStockThreshold)
        : DEFAULT_LOW_STOCK_THRESHOLD;
    normalized.status = PRODUCT_STATUS_VALUES.includes(normalized.status) ? normalized.status : 'active';
    normalized.isFeatured = Boolean(normalized.isFeatured);
    normalized.inventoryState =
        normalized.stock === 0
            ? 'out_of_stock'
            : normalized.stock <= normalized.lowStockThreshold
                ? 'low_stock'
                : 'healthy';

    return normalized;
};

const releaseInventoryForItems = async (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        return;
    }

    const bulkOps = items.map((item) => ({
        updateOne: {
            filter: { _id: item._id },
            update: { $inc: { stock: Number(item.quantity) } }
        }
    }));

    await productModel.bulkWrite(bulkOps, { ordered: false });
};

const reserveInventoryForItems = async (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        return;
    }

    await backfillMissingProductInventory();

    const reservedItems = [];

    try {
        for (const item of items) {
            const quantity = Number(item.quantity);
            const updatedProduct = await productModel.findOneAndUpdate(
                {
                    _id: item._id,
                    status: { $ne: 'archived' },
                    stock: { $gte: quantity }
                },
                {
                    $inc: { stock: -quantity }
                },
                { new: true }
            );

            if (!updatedProduct) {
                throw new Error(`Insufficient stock for ${item.name}`);
            }

            reservedItems.push(item);
        }
    } catch (error) {
        await releaseInventoryForItems(reservedItems);
        throw error;
    }
};

export {
    DEFAULT_LOW_STOCK_THRESHOLD,
    DEFAULT_PRODUCT_STOCK,
    PRODUCT_STATUS_VALUES,
    backfillMissingProductInventory,
    normalizeInventoryFields,
    releaseInventoryForItems,
    reserveInventoryForItems
};
