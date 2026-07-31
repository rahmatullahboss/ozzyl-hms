interface StarRatingProps {
  rating: number;
  reviewCount?: number;
  size?: 'sm' | 'md' | 'lg';
}

export default function StarRating({ rating, reviewCount, size = 'md' }: StarRatingProps) {
  const sizeClass = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-lg' : 'text-sm';
  const stars = Math.round(rating * 2) / 2;

  return (
    <div className={`flex items-center gap-0.5 ${sizeClass}`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={star <= stars ? 'text-yellow-400' : star - 0.5 <= stars ? 'text-yellow-300' : 'text-gray-300'}
        >
          ★
        </span>
      ))}
      <span className="text-gray-600 ml-1">
        {rating > 0 ? rating.toFixed(1) : '—'}
      </span>
      {reviewCount !== undefined && (
        <span className="text-gray-400">({reviewCount})</span>
      )}
    </div>
  );
}
