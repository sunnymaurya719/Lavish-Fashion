import React from 'react';

const columnMap = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
};

/**
 * Responsive grid wrapper for MetricCard. Replaces the duplicated
 * `grid gap-4 md:grid-cols-2 xl:grid-cols-4` strings sprinkled across pages.
 */
const MetricGrid = ({ columns = 4, children, className = '' }) => {
  const colsClass = columnMap[columns] || columnMap[4];
  return <div className={`grid gap-4 ${colsClass} ${className}`}>{children}</div>;
};

export default MetricGrid;
