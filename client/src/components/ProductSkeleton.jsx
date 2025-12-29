const ProductSkeleton = () => {
  return (
    <div className="animate-pulse">
      {/* Image */}
      <div className="bg-gray-300/60 h-48 w-full rounded-md"></div>

      {/* Text */}
      <div className="mt-3 space-y-2">
        <div className="h-4 bg-gray-300/60 rounded w-3/4"></div>
        <div className="h-4 bg-gray-300/60 rounded w-1/2"></div>
      </div>
    </div>
  );
};

export default ProductSkeleton;
