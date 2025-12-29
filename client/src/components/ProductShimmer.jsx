const ProductShimmer = () => {
  return (
    <div className="relative overflow-hidden rounded-md">
      {/* Shimmer overlay */}
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent"></div>

      {/* Image placeholder */}
      <div className="bg-gray-300/60 h-48 w-full rounded-md"></div>

      {/* Text placeholders */}
      <div className="mt-3 space-y-2">
        <div className="h-4 bg-gray-300/60 rounded w-3/4"></div>
        <div className="h-4 bg-gray-300/60 rounded w-1/2"></div>
      </div>
    </div>
  );
};

export default ProductShimmer;
