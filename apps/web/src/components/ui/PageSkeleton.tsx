import { Skeleton, SkeletonCard, SkeletonTable } from './Skeleton';

interface PageSkeletonProps {
  statCards?: number;
  tableRows?: number;
}

export function PageSkeleton({ statCards = 4, tableRows = 5 }: PageSkeletonProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: statCards }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <Skeleton className="h-5 w-40 mb-4" />
        <SkeletonTable rows={tableRows} />
      </div>
    </div>
  );
}
