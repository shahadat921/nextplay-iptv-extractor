
export default function SkeletonList() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
      <div className="h-10 bg-gray-200 rounded-xl w-full"></div>
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-gray-100 rounded-xl w-full"></div>
        ))}
      </div>
    </div>
  );
}
